'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from '@/components/Icons';
import { conditionGradeTableLabel } from '@/components/station/receiving-constants';
import {
  dispatchSelectLine,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';

interface ApiResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
}

interface Props {
  receivingId: number;
  activeLineId: number;
}

/**
 * Multi-item PO accordion. Renders the carton's sibling lines as collapsed
 * rows; the current active line shows highlighted at the top with a
 * "current" chip. Clicking a sibling dispatches `receiving-select-line` to
 * re-mount the workspace on that line — single-active-line semantics, no
 * duplicate form state.
 *
 * Single-line cartons should not mount this component (the parent guards).
 */
export function PoLinesAccordion({ receivingId, activeLineId }: Props) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ['receiving-siblings', receivingId] as const,
    [receivingId],
  );

  const { data } = useQuery<ApiResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(
        `/api/receiving-lines?receiving_id=${receivingId}&include=serials`,
      );
      if (!res.ok) throw new Error('Failed to fetch siblings');
      return res.json();
    },
    enabled: Number.isFinite(receivingId) && receivingId > 0,
    staleTime: 15_000,
  });

  // Local optimistic mirror — receives line-updated patches so progress
  // badges stay live as the operator works.
  const [localRows, setLocalRows] = useState<ReceivingLineRow[]>([]);
  useEffect(() => {
    if (data?.receiving_lines) setLocalRows(data.receiving_lines);
  }, [data]);
  useEffect(() => {
    const handler = (event: Event) => {
      const patch = (event as CustomEvent<Partial<ReceivingLineRow>>).detail;
      if (!patch || typeof patch.id !== 'number') return;
      setLocalRows((rows) =>
        rows.map((r) => (r.id === patch.id ? ({ ...r, ...patch } as ReceivingLineRow) : r)),
      );
    };
    window.addEventListener('receiving-line-updated', handler);
    return () => window.removeEventListener('receiving-line-updated', handler);
  }, []);

  // After a sibling click the workspace re-mounts. Invalidate so the new
  // workspace sees fresh siblings (in case a remote actor edited one).
  useEffect(() => {
    const handler = () => queryClient.invalidateQueries({ queryKey });
    window.addEventListener('usav-refresh-data', handler);
    return () => window.removeEventListener('usav-refresh-data', handler);
  }, [queryClient, queryKey]);

  const rows = localRows;
  if (rows.length <= 1) return null;

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200/60">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500">
          PO lines · {rows.length}
        </h3>
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
          Click to switch
        </span>
      </div>
      <ul className="space-y-1">
        {rows.map((line) => {
          const isActive = line.id === activeLineId;
          return (
            <li key={line.id}>
              <button
                type="button"
                onClick={() => {
                  if (!isActive) dispatchSelectLine(line);
                }}
                aria-current={isActive ? 'true' : undefined}
                className={`group relative flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                  isActive
                    ? 'border-blue-300 bg-blue-50/60'
                    : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${
                    isActive ? '' : '-rotate-90'
                  }`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[12px] font-bold text-gray-900"
                    title={line.item_name ?? undefined}
                  >
                    {line.item_name || line.sku || `Line #${line.id}`}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                    <ProgressBadge
                      received={line.quantity_received}
                      expected={line.quantity_expected}
                    />
                    {' · '}
                    <ConditionBadge grade={line.condition_grade} />
                    {Array.isArray(line.serials) && line.serials.length > 0 ? (
                      <span className="ml-1 text-blue-600">· {line.serials.length} SN</span>
                    ) : null}
                  </p>
                </div>
                {isActive ? (
                  <span className="shrink-0 rounded-md bg-blue-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white">
                    Current
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ProgressBadge({ received, expected }: { received: number; expected: number | null }) {
  if (expected == null || expected <= 0) {
    return <span className="text-gray-600">{received} received</span>;
  }
  const done = received >= expected;
  return (
    <span className={done ? 'text-emerald-600' : 'text-gray-700'}>
      {received}/{expected}
    </span>
  );
}

function ConditionBadge({ grade }: { grade: string | null | undefined }) {
  const g = String(grade || '').trim().toUpperCase();
  if (!g || g === 'PENDING') {
    return <span className="text-gray-400">pending</span>;
  }
  const label = conditionGradeTableLabel(g);
  const tone =
    g === 'BRAND_NEW'
      ? 'text-yellow-600'
      : g === 'PARTS'
        ? 'text-amber-800'
        : g.startsWith('USED')
          ? 'text-gray-600'
          : 'text-gray-500';
  return <span className={tone}>{label}</span>;
}
