'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, LayoutGroup } from 'framer-motion';
import { ChevronDown } from '@/components/Icons';
import { SerialChip, SkuScanRefChip, getLast4 } from '@/components/ui/CopyChip';
import { conditionGradeTableLabel } from '@/components/station/receiving-constants';
import {
  dispatchSelectLine,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';

interface ApiResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
}

type ActiveRowSerial = { id: number; serial_number: string };

interface ActiveRowSlotContext {
  /**
   * Authoritative list of saved serials for the active line, sourced from
   * this accordion's own query. Pass this into the inline serial adder so
   * the chip list below the input always matches the chip shown in the row
   * header — otherwise the two surfaces drift (the parent's `row.serials`
   * is fed from a different fetch cadence).
   */
  serials: ActiveRowSerial[];
}

interface Props {
  receivingId: number;
  activeLineId: number;
  /**
   * Optional slot rendered inside the active row's bubble — condition pills,
   * inline serial adder, etc. Receives the active line's serials so children
   * can consume the accordion's authoritative data rather than re-fetching
   * or relying on parent state.
   */
  activeRowSlot?:
    | React.ReactNode
    | ((ctx: ActiveRowSlotContext) => React.ReactNode);
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
export function PoLinesAccordion({ receivingId, activeLineId, activeRowSlot }: Props) {
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
    // Do NOT refetch on window focus. The Pass+Print flow opens a print
    // popup / silent-print window, which bounces focus and would otherwise
    // refetch and wipe the optimistic verdict the operator just set. The
    // global QueryClient default is `refetchOnWindowFocus: 'always'`, so this
    // override is load-bearing for the testing workspace.
    refetchOnWindowFocus: false,
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

  // Keep rows in their original order from the API so clicking a sibling
  // feels like a local expand/collapse, not a "row jumps to the bottom"
  // switch. The active row still highlights + shows its slot in place; the
  // collapsed siblings stay anchored where they were.
  const rows = localRows;
  // Always render — even for single-line POs the row layout (title, qty,
  // condition, sku, serial chip) is the canonical context display the
  // workspace expects above the body.
  if (rows.length === 0) return null;

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200/60">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-caption font-bold uppercase tracking-[0.14em] text-gray-500">
          PO items · {rows.length}
        </h3>
        {rows.length > 1 ? (
          <span className="text-micro font-bold uppercase tracking-widest text-gray-400">
            Click to switch
          </span>
        ) : null}
      </div>
      <LayoutGroup id={`po-lines-${receivingId}`}>
      <ul className="flex flex-col gap-1">
        {rows.map((line) => {
          const isActive = line.id === activeLineId;
          return (
            <motion.li
              key={line.id}
              layout="position"
              transition={{ type: 'spring', stiffness: 380, damping: 32, mass: 0.7 }}
              aria-current={isActive ? 'true' : undefined}
              className={`relative rounded-xl border transition-colors ${
                isActive
                  ? 'border-blue-300 bg-blue-50/60'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              {/* Click area = title + meta. Kept as a <div role="button"> so
                  interactive children (condition pills) can render inside
                  the bubble without producing nested <button> markup. */}
              <div
                role={isActive ? undefined : 'button'}
                tabIndex={isActive ? -1 : 0}
                onClick={() => {
                  if (!isActive) dispatchSelectLine(line);
                }}
                onKeyDown={(e) => {
                  if (isActive) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    dispatchSelectLine(line);
                  }
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
                  isActive ? '' : 'cursor-pointer'
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
                    className="truncate text-label font-bold text-gray-900"
                    title={line.item_name ?? undefined}
                  >
                    {line.item_name || line.sku || `Line #${line.id}`}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 truncate text-micro font-semibold uppercase tracking-widest text-gray-500">
                    <ProgressBadge
                      received={line.quantity_received}
                      expected={line.quantity_expected}
                    />
                    <span aria-hidden>·</span>
                    <ConditionBadge grade={line.condition_grade} />
                    {(line.sku || '').trim() ? (
                      <>
                        <span aria-hidden>·</span>
                        <SkuScanRefChip
                          value={line.sku as string}
                          display={getLast4(line.sku)}
                        />
                      </>
                    ) : null}
                    {Array.isArray(line.serials) && line.serials.length > 0 ? (
                      <>
                        <span aria-hidden>·</span>
                        {line.serials
                          .map((s) => (s.serial_number || '').trim())
                          .filter(Boolean)
                          .map((sn, i) => (
                            <SerialChip
                              key={`${sn}-${i}`}
                              value={sn}
                              display={sn.length > 4 ? sn.slice(-4) : sn}
                              width="w-fit max-w-full"
                            />
                          ))}
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
              {/* Active row only — slot for condition pills, serial adder,
                  etc. Passes the line's own serials (from this accordion's
                  query) so the inline adder shows the same chips the row
                  header shows. */}
              {isActive && activeRowSlot ? (
                <div className="border-t border-blue-200/60 px-3 py-3">
                  {typeof activeRowSlot === 'function'
                    ? activeRowSlot({ serials: line.serials ?? [] })
                    : activeRowSlot}
                </div>
              ) : null}
            </motion.li>
          );
        })}
      </ul>
      </LayoutGroup>
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

