'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, LayoutGroup } from 'framer-motion';
import { ChevronDown, Plus } from '@/components/Icons';
import { toast } from '@/lib/toast';
import { SerialChip, SkuScanRefChip, getLast4 } from '@/components/ui/CopyChip';
import { SerialChipWithMenu } from '@/components/receiving/workspace/SerialCard';
import { HandlingUnitChip } from '@/components/receiving/HandlingUnitChip';
import {
  CartonAddPopover,
  type AssignedBox,
  type CartonAddSelection,
} from '@/components/receiving/workspace/CartonAddPopover';
import { setSerialEditHandoff } from '@/components/receiving/workspace/serialEditHandoff';
import { conditionGradeTableLabel } from '@/components/station/receiving-constants';
import {
  dispatchSelectLine,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';

interface ApiResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
}

// `id` is optional to stay structurally compatible with the chip menu's
// `SavedSerial` (whose id is optional). Callbacks guard with `if (s.id == null)`.
export type ActiveRowSerial = { id?: number; serial_number: string; condition_grade?: string | null };

export interface PoLineSerialActions {
  editingSerialId?: number | null;
  /**
   * Edit a serial. `lineId` is the row the chip belongs to — NOT necessarily
   * the active row, since the menu is offered on every row. For a non-active
   * row the accordion activates that line first (so its scan input mounts);
   * the parent then targets the serial for in-place editing on that line.
   */
  onEdit?: (serial: ActiveRowSerial, lineId: number) => void;
  /**
   * Delete a serial from its own `lineId`. The scan-serial DELETE endpoint
   * only removes a unit that still points at the given line, so the parent
   * MUST route the delete to `lineId` (not the active row).
   */
  onDelete?: (serial: ActiveRowSerial, lineId: number) => void;
}

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
  /**
   * Condition grade of the unit currently selected in the active row's body
   * (multi-qty lines). When set, the active row's header condition badge shows
   * this instead of the line-level grade, so the header tracks the selected
   * unit. Null/undefined → fall back to `line.condition_grade`.
   */
  activeConditionOverride?: string | null;
  /**
   * Edit/delete for serial copy-chips in the active row header. Condition is
   * set via the line-level picker in the row body, not on chip hover.
   */
  activeSerialActions?: PoLineSerialActions;
  /**
   * Read-only display (triage). Drops the expand chevron, the "Click to switch"
   * hint, and the row click-to-switch — nothing on a line can change until it's
   * unboxed, so the accordion is just a flat list of what's on the PO.
   */
  readOnly?: boolean;
  /**
   * Testing context only: hide lines marked needs_test=false (cables / no-test
   * items) so they don't appear in the tester's per-PO list. The active line is
   * always kept visible. Off in the unbox workspace, where every line matters.
   */
  hideNoTestLines?: boolean;
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
export function PoLinesAccordion({
  receivingId,
  activeLineId,
  activeRowSlot,
  activeConditionOverride,
  activeSerialActions,
  readOnly = false,
  hideNoTestLines = false,
}: Props) {
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

  // Active row collapse — the chevron toggles the active line's body (slot)
  // closed so a high-qty line (x100 unit rows) doesn't lock the workspace to
  // a wall of rows. Re-expands whenever the active line changes.
  const [activeCollapsed, setActiveCollapsed] = useState(false);
  useEffect(() => {
    setActiveCollapsed(false);
  }, [activeLineId]);

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
  // In the testing workspace, no-test lines (cables toggled off) are hidden so
  // they don't clutter the tester's list — but the active line is always kept
  // so a mid-flow toggle never blanks the workspace.
  const rows = hideNoTestLines
    ? localRows.filter((r) => r.id === activeLineId || r.needs_test !== false)
    : localRows;
  // Serial-unit ids across every line of this carton — the atoms an LPN box
  // groups. Drives the "Add to box" control in the header (mint H-{id} +
  // seed the whole carton). Empty until at least one serial is scanned.
  const cartonUnitIds = useMemo(
    () =>
      localRows.flatMap((r) =>
        (r.serials ?? [])
          .map((s) => s.id)
          .filter((id): id is number => typeof id === 'number'),
      ),
    [localRows],
  );
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
        {!readOnly ? (
          <CartonAddAction receivingId={receivingId} unitIds={cartonUnitIds} />
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
                role={!readOnly && !isActive ? 'button' : undefined}
                tabIndex={!readOnly && !isActive ? 0 : -1}
                onClick={() => {
                  if (!readOnly && !isActive) dispatchSelectLine(line);
                }}
                onKeyDown={(e) => {
                  if (readOnly || isActive) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    dispatchSelectLine(line);
                  }
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
                  !readOnly && !isActive ? 'cursor-pointer' : ''
                }`}
              >
                {!readOnly ? (
                  isActive ? (
                    // Active row: the chevron is a real toggle — click to
                    // collapse/expand the row body (condition pills, unit
                    // rows). Essential on multi-qty lines where the expanded
                    // body is taller than the viewport.
                    <button
                      type="button"
                      aria-expanded={!activeCollapsed}
                      aria-label={activeCollapsed ? 'Expand item details' : 'Collapse item details'}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveCollapsed((v) => !v);
                      }}
                      className="-m-1 flex shrink-0 items-center justify-center rounded-md p-1 text-gray-400 transition-colors hover:bg-blue-100 hover:text-gray-600"
                    >
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${
                          activeCollapsed ? '-rotate-90' : ''
                        }`}
                        aria-hidden
                      />
                    </button>
                  ) : (
                    <ChevronDown
                      className="h-3.5 w-3.5 shrink-0 -rotate-90 text-gray-400 transition-transform"
                      aria-hidden
                    />
                  )
                ) : null}
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-label font-bold text-gray-900"
                    title={line.item_name ?? undefined}
                  >
                    {line.item_name || line.sku || `Line #${line.id}`}
                  </p>
                  {/* No `truncate` here: `flex flex-wrap` already wraps the
                      badges/chips, and `truncate`'s `overflow: hidden` would
                      clip the SerialChipWithMenu dropdown (positioned below the
                      row). The chip menu is not portaled, so any clipping
                      ancestor hides it. */}
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-micro font-semibold uppercase tracking-widest text-gray-500">
                    <ProgressBadge
                      received={line.quantity_received}
                      expected={line.quantity_expected}
                    />
                    <span aria-hidden>·</span>
                    <ConditionBadge
                      grade={
                        isActive && activeConditionOverride
                          ? activeConditionOverride
                          : line.condition_grade
                      }
                    />
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
                        {line.serials.map((s, i) => {
                          const sn = (s.serial_number || '').trim();
                          if (!sn) return null;
                          const serialRecord: ActiveRowSerial = {
                            id: s.id,
                            serial_number: sn,
                            condition_grade:
                              (s as { condition_grade?: string | null }).condition_grade ?? null,
                          };
                          // Offer the Edit/Delete menu on EVERY row, not just
                          // the active one. Editing a chip on a collapsed row
                          // activates that line first (dispatchSelectLine) so
                          // its scan input mounts; delete is routed to the
                          // chip's own line id by the parent.
                          if (!readOnly && (activeSerialActions?.onEdit || activeSerialActions?.onDelete)) {
                            const { onEdit, onDelete } = activeSerialActions;
                            return (
                              <SerialChipWithMenu
                                key={`${sn}-${i}`}
                                serial={serialRecord}
                                isEditing={isActive && activeSerialActions.editingSerialId === s.id}
                                onEdit={
                                  onEdit
                                    ? (target) => {
                                        if (isActive) {
                                          onEdit(target, line.id);
                                        } else {
                                          // Non-active row: the workspace may
                                          // remount on the line switch, so stash
                                          // the target in a module store the new
                                          // workspace consumes for this line.
                                          setSerialEditHandoff(line.id, target);
                                          dispatchSelectLine(line);
                                        }
                                      }
                                    : undefined
                                }
                                onDelete={
                                  onDelete ? (target) => onDelete(target, line.id) : undefined
                                }
                              />
                            );
                          }
                          return (
                            <SerialChip
                              key={`${sn}-${i}`}
                              value={sn}
                              width="w-fit max-w-full"
                            />
                          );
                        })}
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
              {/* Active row only — slot for condition pills, serial adder,
                  etc. Passes the line's own serials (from this accordion's
                  query) so the inline adder shows the same chips the row
                  header shows. Hidden while the chevron has collapsed the row. */}
              {isActive && !activeCollapsed && activeRowSlot ? (
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

/**
 * Carton add action — a `+` button (same shape as the unfound "+ Add item"
 * CTA) that opens the shared CartonAddPopover (Item · Web · Box). On a matched
 * carton, Item/Web add an **off-PO** line (an extra item in the box the Zoho PO
 * doesn't list — see add-unmatched-line `allow_off_po`); Box groups the
 * carton's units into a handling unit + prints its LPN label.
 */
function CartonAddAction({ receivingId, unitIds }: { receivingId: number; unitIds: number[] }) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<AssignedBox | null>(null);

  // Add an off-PO extra item to this matched carton, then refresh the accordion
  // so the new line shows. The receive flow leaves it Zoho-unlinked (skipped
  // from the Zoho POST); the operator reconciles it on the PO separately.
  const addOffPoLine = useCallback(
    async (sel: CartonAddSelection) => {
      const clientEventId = `add-offpo-${receivingId}-${Date.now()}`;
      const res = await fetch('/api/receiving/add-unmatched-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': clientEventId },
        body: JSON.stringify({
          receiving_id: receivingId,
          allow_off_po: true,
          sku_catalog_id: sel.sku_catalog_id,
          ...(sel.sku_platform_id_row != null ? { sku_platform_id_row: sel.sku_platform_id_row } : {}),
          sku: sel.sku || undefined,
          item_name: sel.item_name,
          client_event_id: clientEventId,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !body.success) {
        toast.error(body.error ?? `add failed (${res.status})`);
        return;
      }
      toast.success(`Added off-PO · ${sel.item_name || sel.sku || 'item'}`);
      // The accordion invalidates its siblings query on this event.
      window.dispatchEvent(new Event('usav-refresh-data'));
      setOpen(false);
    },
    [receivingId],
  );

  return (
    <div className="flex items-center gap-1.5">
      {box ? (
        <HandlingUnitChip handlingUnitId={box.id} code={box.code} unitCount={box.total} dense />
      ) : null}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Add to carton"
        title="Add to carton — off-PO item, web result, or a handling-unit box"
        className="flex h-6 w-6 items-center justify-center rounded-xl bg-blue-600 text-white transition-colors hover:bg-blue-700"
      >
        <Plus className="h-4 w-4" />
      </button>
      {open ? (
        <CartonAddPopover
          tabs={['item', 'web', 'box']}
          initialTab="item"
          unitIds={unitIds}
          onAddLine={addOffPoLine}
          addLineHint="Adds as an off-PO item — not on the Zoho PO. Reconcile it in Zoho separately."
          onAssignedBox={setBox}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** Exported for UnmatchedItemsSection so unfound line rows render the exact
 *  same qty/condition meta as matched PO items. */
export function ProgressBadge({ received, expected }: { received: number; expected: number | null }) {
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

export function ConditionBadge({ grade }: { grade: string | null | undefined }) {
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

