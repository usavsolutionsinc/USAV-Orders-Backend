'use client';

import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { StationScanBar } from '@/components/station/StationScanBar';
import { Barcode, Check, AlertTriangle } from '@/components/Icons';
import { getLast4 } from '@/components/ui/CopyChip';

interface ScanOutResult {
  ok: boolean;
  matched: boolean;
  duplicate?: boolean;
  /** Carrier already reports DELIVERED — scanning out is an exception, not a handoff. */
  alreadyDelivered?: boolean;
  shipmentId?: number;
  tracking?: string | null;
  orderId?: string | null;
  productTitle?: string | null;
  message?: string | null;
}

/** Shared cache busts for any scan-out / undo (crosses the warehouse boundary). */
const SCAN_OUT_KEYS = [
  ['dashboard-table', 'shipped'],
  ['dashboard-table', 'unshipped'],
  ['dashboard-table', 'pending'],
  ['packer-logs'],
] as const;

/**
 * Scan-out sidebar: the dock "scan label to ship out" bar + a one-line result
 * confirmation. The outbound-state counts/legend live in the always-on
 * {@link OutboundStatusLegend} (shown in BOTH Shipped modes), so they are not
 * repeated here.
 */
export function ShippedScanOutSidebar({ autoFocus = true }: { autoFocus?: boolean } = {}) {
  const queryClient = useQueryClient();
  const [scanValue, setScanValue] = useState('');
  const [lastResult, setLastResult] = useState<{ kind: 'ok' | 'dup' | 'miss' | 'err' | 'exc'; text: string } | null>(null);
  // Set only on a fresh, reversible scan-out — drives the inline Undo affordance.
  const [undoable, setUndoable] = useState<{ shipmentId: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refocus = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);
  const bustCaches = useCallback(() => {
    for (const queryKey of SCAN_OUT_KEYS) queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }, [queryClient]);

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
      setUndoable(null);
      if (!result.matched) {
        setLastResult({ kind: 'miss', text: result.message || 'No shipment found for that label' });
        return;
      }
      const label = result.orderId ? `#${getLast4(result.orderId)}` : (result.tracking ?? '');
      if (result.alreadyDelivered) {
        // Anomaly — carrier already delivered this. No SHIP_CONFIRM was recorded;
        // surface it red so the operator stops and checks the package.
        setLastResult({ kind: 'exc', text: `Delivered already — ${label}` });
        return;
      }
      if (result.duplicate) {
        setLastResult({ kind: 'dup', text: `Already scanned out — ${label}` });
      } else {
        setLastResult({ kind: 'ok', text: `Out — ${result.productTitle || label}` });
        if (result.shipmentId) setUndoable({ shipmentId: result.shipmentId });
      }
      // A scan-out crosses the warehouse boundary (PACKED_STAGED → SCANNED_OUT),
      // so it leaves BOTH pre-dock boards (unshipped/pending) and lands in shipped.
      bustCaches();
    },
    onError: () => {
      setLastResult({ kind: 'err', text: 'Scan-out failed — try again' });
    },
  });

  const undo = useMutation({
    mutationFn: async (shipmentId: number): Promise<void> => {
      const res = await fetch('/api/shipped/scan-out', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipmentId }),
      });
      if (!res.ok) throw new Error(`undo failed (${res.status})`);
    },
    onSuccess: () => {
      setUndoable(null);
      setLastResult(null);
      bustCaches();
      refocus();
    },
    onError: () => {
      setLastResult({ kind: 'err', text: 'Undo failed — try again' });
    },
  });

  const handleSubmit = useCallback(() => {
    const v = scanValue.trim();
    if (!v || scanOut.isPending) return;
    scanOut.mutate(v);
    setScanValue('');
    refocus();
  }, [scanValue, scanOut, refocus]);

  const feedbackTone =
    lastResult?.kind === 'ok'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : lastResult?.kind === 'dup'
        ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : 'bg-rose-50 text-rose-700 ring-rose-200';

  return (
    <div>
      {/* Result sits ABOVE the scan bar — the bar is pinned at the sidebar's
          bottom edge, so feedback below it would clip off-screen. */}
      {lastResult ? (
        <div
          className={`mb-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${feedbackTone}`}
        >
          {lastResult.kind === 'ok' ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          <span className="truncate">{lastResult.text}</span>
          {undoable && lastResult.kind === 'ok' ? (
            <button
              type="button"
              onClick={() => undo.mutate(undoable.shipmentId)}
              disabled={undo.isPending}
              className="ml-auto shrink-0 font-bold uppercase tracking-wide text-emerald-700 underline-offset-2 hover:underline disabled:opacity-50"
            >
              {undo.isPending ? 'Undoing…' : 'Undo'}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Themed like the Testing station scan bar: emerald (ship-out) stroke +
          focus ring + leading icon, instead of the plain gray field. */}
      <StationScanBar
        value={scanValue}
        onChange={setScanValue}
        onSubmit={handleSubmit}
        inputRef={inputRef}
        autoFocus={autoFocus}
        placeholder="Scan label to ship out…"
        icon={<Barcode className="h-4 w-4" />}
        iconClassName="text-emerald-600"
        inputBorderClassName="border-2 border-emerald-200"
        inputClassName="bg-white focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-400"
        hasRightContent={false}
        onPaste={(text) => setScanValue(text)}
      />
    </div>
  );
}
