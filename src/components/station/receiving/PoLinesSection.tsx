'use client';

import { useState } from 'react';
import { Check, Loader2, Package } from '@/components/Icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SkuScanRefChip,
  SerialChip,
  getLast4,
  getLast6Serial,
} from '@/components/ui/CopyChip';
import {
  conditionGradeTableLabel,
  workflowStatusTableLabel,
} from '@/components/station/receiving-constants';

interface ReceivingLine {
  id: number;
  item_name: string | null;
  sku: string | null;
  zoho_purchaseorder_id: string | null;
  quantity_expected: number | null;
  quantity_received: number;
  workflow_status: string;
  qa_status: string;
  condition_grade: string;
  needs_test: boolean;
  assigned_tech_name: string | null;
  notes: string | null;
  /** Optional serials when the /api/receiving/match payload includes them. */
  serials?: Array<{ id?: number; serial_number: string }> | null;
}

interface PoLinesSectionProps {
  receivingId: string;
  trackingNumber?: string;
}

const WORKFLOW_BADGE: Record<string, string> = {
  EXPECTED:      'bg-gray-100 text-gray-500',
  ARRIVED:       'bg-blue-100 text-blue-600',
  MATCHED:       'bg-indigo-100 text-indigo-700',
  UNBOXED:       'bg-yellow-100 text-yellow-700',
  AWAITING_TEST: 'bg-orange-100 text-orange-700',
  IN_TEST:       'bg-teal-100 text-teal-700',
  PASSED:        'bg-emerald-100 text-emerald-700',
  FAILED:        'bg-red-100 text-red-600',
  DONE:          'bg-emerald-100 text-emerald-700',
};

/**
 * Per-line row in the PO LINES details card. Two-row stacked layout to fit
 * the narrow side panel:
 *   - Row 1: PO + tracking copy chips (left) and qty pill (right).
 *   - Row 2: full-width item title, then condition + workflow status badges.
 *
 * The shared `ReceivingLineOrderRow` is built for the wider main table and
 * its single-row chip grid truncates badly inside this card.
 */
function PoLineRow({ line }: { line: ReceivingLine }) {
  const qtyOk =
    (line.quantity_expected ?? 0) > 0
      ? line.quantity_received >= (line.quantity_expected ?? 0)
      : false;
  const badgeCls = WORKFLOW_BADGE[line.workflow_status] ?? 'bg-gray-100 text-gray-500';
  const conditionLabel = conditionGradeTableLabel(line.condition_grade);
  const condGrade = (line.condition_grade || '').toUpperCase();
  const conditionColor =
    condGrade === 'BRAND_NEW'
      ? 'text-yellow-600'
      : condGrade === 'PARTS'
        ? 'text-amber-800'
        : 'text-gray-500';
  const skuValue = (line.sku || '').trim();
  const serialsCsv = Array.isArray(line.serials)
    ? line.serials.map((s) => (s.serial_number || '').trim()).filter(Boolean).join(', ')
    : '';

  return (
    <div className="border-b border-gray-100 last:border-b-0 px-3 py-2.5">
      {/* Row 1 — full-width product title. No truncation; wraps as needed. */}
      <p
        className="text-[12px] font-bold text-gray-900 leading-snug"
        title={line.item_name ?? undefined}
      >
        {line.item_name || line.sku || `Line #${line.id}`}
      </p>

      {/* Row 2 — bottom strip:
            LEFT  → qty + workflow / condition / needs-test badges
            RIGHT → SKU + serial copy chips */}
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span
            className={`flex shrink-0 items-center gap-0.5 text-[11px] font-black tabular-nums ${
              qtyOk ? 'text-emerald-600' : 'text-gray-700'
            }`}
          >
            {line.quantity_received}
            <span className="text-gray-300">/</span>
            <span className="text-gray-400">{line.quantity_expected ?? '?'}</span>
            {qtyOk ? <Check className="h-3 w-3 text-emerald-500" aria-hidden /> : null}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${badgeCls}`}
          >
            {workflowStatusTableLabel(line.workflow_status)}
          </span>
          {condGrade && condGrade !== 'PENDING' ? (
            <span
              className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ring-1 ring-inset ring-gray-200 ${conditionColor}`}
            >
              {conditionLabel}
            </span>
          ) : null}
          {line.needs_test ? (
            <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-orange-700">
              Test
            </span>
          ) : null}
          {line.assigned_tech_name ? (
            <span className="truncate text-[9px] font-bold text-gray-400">
              → {line.assigned_tech_name}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {skuValue ? (
            <SkuScanRefChip value={skuValue} display={getLast4(skuValue)} />
          ) : null}
          {serialsCsv ? (
            <SerialChip value={serialsCsv} display={getLast6Serial(serialsCsv)} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function PoLinesSection({ receivingId, trackingNumber }: PoLinesSectionProps) {
  const [markingReceived, setMarkingReceived] = useState(false);
  const [markResult, setMarkResult] = useState<'idle' | 'ok' | 'err'>('idle');
  const queryClient = useQueryClient();

  const { data, isFetching, refetch } = useQuery<{ lines: ReceivingLine[]; matched: boolean }>({
    queryKey: ['receiving-match', receivingId],
    queryFn: async () => {
      const res = await fetch(`/api/receiving/match?receiving_id=${receivingId}`);
      if (!res.ok) return { lines: [], matched: false };
      const json = await res.json();
      const lines: ReceivingLine[] = Array.isArray(json?.matched_lines) ? json.matched_lines : [];
      return { lines, matched: lines.length > 0 };
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const lines = data?.lines ?? [];

  const handleSearchAndLink = async () => {
    if (!trackingNumber?.trim()) return;
    setMarkingReceived(true);
    setMarkResult('idle');
    try {
      const res = await fetch('/api/receiving/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiving_id: Number(receivingId) }),
      });
      if (!res.ok) throw new Error('Match failed');
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['receiving-pending-unboxing'] });
      setMarkResult('ok');
    } catch {
      setMarkResult('err');
    } finally {
      setMarkingReceived(false);
    }
  };

  return (
    <div className="space-y-2">
      {isFetching && lines.length === 0 ? (
        <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
      ) : null}

      {lines.length === 0 ? (
        <div className="text-center py-4 space-y-2">
          <p className="text-[10px] font-bold text-gray-400">No items linked yet.</p>
          <button
            type="button"
            onClick={handleSearchAndLink}
            disabled={markingReceived}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50 transition-all"
          >
            {markingReceived ? <Loader2 className="h-3 w-3 animate-spin" /> : <Package className="h-3 w-3" />}
            Search Zoho PO
          </button>
          {markResult === 'err' && (
            <p className="text-[9px] text-red-500 font-bold">Search failed — try again</p>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {lines.map((line) => (
            <PoLineRow key={line.id} line={line} />
          ))}
        </div>
      )}
    </div>
  );
}
