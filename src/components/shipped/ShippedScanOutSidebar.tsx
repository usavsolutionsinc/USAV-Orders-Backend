'use client';

import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { StationScanBar } from '@/components/station/StationScanBar';
import { MetricLineRow } from '@/design-system/components/MetricLineRow';
import { Barcode, Check, Loader2, AlertTriangle } from '@/components/Icons';
import { getLast4 } from '@/components/ui/CopyChip';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { OUTBOUND_STATE_META, type OutboundState } from '@/lib/outbound-state';
import { useShippedScanOutData, type OutboundCounts } from '@/hooks/useShippedScanOutData';

interface ScanOutResult {
  ok: boolean;
  matched: boolean;
  duplicate?: boolean;
  tracking?: string | null;
  orderId?: string | null;
  productTitle?: string | null;
  message?: string | null;
}

/** Sidebar tiles, mapped to the cross-reference buckets (Exception folds in PROCESS_GAP). */
const TILES: Array<{ key: string; state: OutboundState; label: string; text: string }> = [
  { key: 'staging', state: 'PACKED_STAGED', label: 'In Staging', text: 'text-amber-600' },
  { key: 'scanned', state: 'SCANNED_OUT', label: 'Scanned Out', text: 'text-blue-600' },
  { key: 'custody', state: 'IN_CUSTODY', label: 'In Custody', text: 'text-indigo-600' },
  { key: 'delivered', state: 'DELIVERED', label: 'Delivered', text: 'text-emerald-600' },
  { key: 'orphan', state: 'ORPHAN', label: 'Orphan', text: 'text-fuchsia-600' },
  { key: 'exception', state: 'EXCEPTION', label: 'Exception', text: 'text-rose-600' },
];

function tileValue(counts: OutboundCounts, key: string, state: OutboundState): number {
  return key === 'exception' ? counts.EXCEPTION + counts.PROCESS_GAP : counts[state];
}

/**
 * Scan-out sidebar panel: the dock "scan label to ship out" bar + the daily
 * cross-reference tiles. Pairs with the main list on the right — this is the
 * controls/summary half of the split scan-out view.
 */
export function ShippedScanOutSidebar() {
  const queryClient = useQueryClient();
  const { counts, isFetching } = useShippedScanOutData();
  const [scanValue, setScanValue] = useState('');
  const [sessionCount, setSessionCount] = useState(0);
  const [lastResult, setLastResult] = useState<{ kind: 'ok' | 'dup' | 'miss' | 'err'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scanOut = useMutation({
    mutationFn: async (tracking: string): Promise<ScanOutResult> => {
      const res = await fetch('/api/shipped/scan-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackingNumber: tracking }),
      });
      if (!res.ok) throw new Error(`scan-out failed (${res.status})`);
      return res.json();
    },
    onSuccess: (result) => {
      if (!result.matched) {
        setLastResult({ kind: 'miss', text: result.message || 'No shipment found for that label' });
        return;
      }
      const label = result.orderId ? `#${getLast4(result.orderId)}` : (result.tracking ?? '');
      if (result.duplicate) {
        setLastResult({ kind: 'dup', text: `Already scanned out — ${label}` });
      } else {
        setSessionCount((n) => n + 1);
        setLastResult({ kind: 'ok', text: `Out — ${result.productTitle || label}` });
      }
      queryClient.invalidateQueries({ queryKey: ['dashboard-table', 'shipped'] });
      queryClient.invalidateQueries({ queryKey: ['packer-logs'] });
    },
    onError: () => setLastResult({ kind: 'err', text: 'Scan-out failed — try again' }),
  });

  const handleSubmit = useCallback(() => {
    const v = scanValue.trim();
    if (!v || scanOut.isPending) return;
    scanOut.mutate(v);
    setScanValue('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [scanValue, scanOut]);

  const feedbackTone =
    lastResult?.kind === 'ok'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : lastResult?.kind === 'dup'
        ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : 'bg-rose-50 text-rose-700 ring-rose-200';

  return (
    <div className="space-y-4">
      <div>
        <StationScanBar
          value={scanValue}
          onChange={setScanValue}
          onSubmit={handleSubmit}
          inputRef={inputRef}
          autoFocus
          placeholder="Scan label to ship out…"
          icon={<Barcode className="h-4 w-4" />}
          hasRightContent={false}
          onPaste={(text) => setScanValue(text)}
        />

        {/* Running "shipped out" counter — below the scan bar */}
        <div className="mt-2 flex items-center justify-end">
          <div className="flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 ring-1 ring-inset ring-gray-200">
            {scanOut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
            ) : (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            )}
            <span className="text-sm font-black tabular-nums text-gray-800">{sessionCount}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">out</span>
          </div>
        </div>

        {lastResult ? (
          <div
            className={`mt-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${feedbackTone}`}
          >
            {lastResult.kind === 'ok' ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            <span className="truncate">{lastResult.text}</span>
          </div>
        ) : null}
      </div>

      {/* Cross-reference tiles — reuse MetricLineRow (DS) */}
      <div>
        <div className="flex items-center justify-between">
          <p className={`${microBadge} text-gray-500`}>Cross-Reference</p>
          {isFetching ? <Loader2 className="h-3 w-3 animate-spin text-blue-400" /> : null}
        </div>
        <div className="mt-1">
          {TILES.map((t) => (
            <MetricLineRow
              key={t.key}
              interactive={false}
              label={
                <span className="inline-flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${OUTBOUND_STATE_META[t.state].dot}`} />
                  {t.label}
                </span>
              }
              value={
                <span className={`text-lg font-black tabular-nums ${t.text}`}>
                  {tileValue(counts, t.key, t.state)}
                </span>
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
