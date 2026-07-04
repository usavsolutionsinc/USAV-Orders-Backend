'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { receivingSiblingsQueryKey } from '@/lib/queries/receiving-queries';
import { motion, LayoutGroup } from 'framer-motion';
import { ChevronDown, Pencil, FileText, Check } from '@/components/Icons';
import {
  framerPresence,
  framerTransition,
  motionBezier,
} from '@/design-system/foundations/motion-framer';
import {
  useMotionPresence,
  useMotionTransition,
} from '@/design-system/foundations/motion-framer-hooks';
import type { InlineActionFeedbackPayload } from './InlineActionFeedbackCard';
import { toast } from '@/lib/toast';
import { ConditionGradeChip, SerialChip, SkuScanRefChip, UnitPriceChip, getLast4 } from '@/components/ui/CopyChip';
import { SerialChipWithMenu } from '@/components/receiving/workspace/SerialCard';
import { HandlingUnitChip } from '@/components/receiving/HandlingUnitChip';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import { qtyProgress } from '@/design-system/tokens/typography/presets';
import { META_COL } from '@/components/ui/RowMetaColumns';
import { cn } from '@/utils/_cn';
import {
  CartonAddPopover,
  type AssignedBox,
  type CartonAddSelection,
} from '@/components/receiving/workspace/CartonAddPopover';
import { setSerialEditHandoff } from '@/components/receiving/workspace/serialEditHandoff';
import {
  dispatchSelectLine,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';

interface ApiResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
}

// Stable empty array so `data?.receiving_lines ?? EMPTY_ROWS` keeps a constant
// reference while loading — prevents the `useMemo`/`layout` deps from churning
// on every render before the first fetch resolves.
const EMPTY_ROWS: ReceivingLineRow[] = [];

/** Sibling row reorder when the active line changes — softer than the default layout spring. */
const PO_LINE_LAYOUT_SPRING = {
  type: 'spring' as const,
  stiffness: 220,
  damping: 36,
  mass: 0.9,
};

/** Active row body expand/collapse — slower + layout-eased than stationCollapse. */
const PO_LINE_BODY_COLLAPSE = {
  height: {
    type: 'tween' as const,
    duration: 0.4,
    ease: motionBezier.layout,
  },
  opacity: {
    type: 'tween' as const,
    duration: 0.32,
    ease: motionBezier.easeOut,
  },
};

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
  /** Success/error feedback renders below the label preview in LineEditPanel. */
  onItemDescFeedback?: (feedback: InlineActionFeedbackPayload | null) => void;
  /** Called after a successful local + Zoho item-description save. */
  onItemDescSaved?: (lineId: number, zohoNotes: string | null) => void;
  /**
   * The already-known active line (the row the workspace opened on). Used as the
   * query `placeholderData` so the clicked line paints INSTANTLY on a cold open
   * while the full sibling list fetches — kills the "takes a second to render the
   * PO line" gap. Ignored once real (or cached) data is present.
   */
  placeholderActiveRow?: ReceivingLineRow;
  /**
   * Render bare (no own card chrome, no add "+" pencil) — used when composed
   * inside the unified {@link POUnboxingSection} wrapper, which supplies the
   * single shared card + edit pencil. Defaults to the standalone card so the
   * testing display and any other caller are unaffected.
   */
  embedded?: boolean;
  /**
   * Embedded-only: node rendered at the right of the "PO items · N" header row
   * (e.g. the wrapper's shared edit pencil). Lets the unified wrapper place its
   * single control on the same row as the item count.
   */
  headerRight?: React.ReactNode;
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
  onItemDescFeedback,
  onItemDescSaved,
  placeholderActiveRow,
  embedded = false,
  headerRight,
}: Props) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => receivingSiblingsQueryKey(receivingId), [receivingId]);

  // Single-line placeholder so a cold open paints the clicked line immediately
  // (the full sibling list replaces it the moment the fetch resolves). Stable
  // per line id so it doesn't churn the query each render.
  const placeholderData = useMemo<ApiResponse | undefined>(
    () =>
      placeholderActiveRow && placeholderActiveRow.id > 0
        ? { success: true, receiving_lines: [placeholderActiveRow] }
        : undefined,
    [placeholderActiveRow],
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
    placeholderData,
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

  // Optimistic `receiving-line-updated` patches go straight into the QUERY
  // CACHE, so the render below derives from a SINGLE source of truth (`data`).
  //
  // This is the load-bearing flicker fix. The old code mirrored `data` into a
  // `localRows` state via `useEffect`, and that state starts EMPTY on every
  // (re)mount. Because passive effects run AFTER paint, each mount painted one
  // blank frame (`rows.length === 0 → return null`) before the effect
  // repopulated it — and the workspace REMOUNTS on every sibling line-switch,
  // so the PO list blinked on each switch. Reading straight from cached `data`
  // renders the rows immediately: the sibling query is keyed by the shared
  // carton `receiving_id`, so it's already warm across line switches.
  useEffect(() => {
    const handler = (event: Event) => {
      const patch = (event as CustomEvent<Partial<ReceivingLineRow>>).detail;
      if (!patch || typeof patch.id !== 'number') return;
      queryClient.setQueryData<ApiResponse>(queryKey, (prev) =>
        prev?.receiving_lines
          ? {
              ...prev,
              receiving_lines: prev.receiving_lines.map((r) =>
                r.id === patch.id ? ({ ...r, ...patch } as ReceivingLineRow) : r,
              ),
            }
          : prev,
      );
    };
    window.addEventListener('receiving-line-updated', handler);
    return () => window.removeEventListener('receiving-line-updated', handler);
  }, [queryClient, queryKey]);

  // After a sibling click the workspace re-mounts. Invalidate so the new
  // workspace sees fresh siblings (in case a remote actor edited one).
  useEffect(() => {
    const handler = () => queryClient.invalidateQueries({ queryKey });
    window.addEventListener('usav-refresh-data', handler);
    return () => window.removeEventListener('usav-refresh-data', handler);
  }, [queryClient, queryKey]);

  // Single source of truth = the query cache. Original API order is preserved so
  // clicking a sibling feels like a local expand/collapse, not a "row jumps to
  // the bottom" switch. In the testing workspace, no-test lines (cables toggled
  // off) are hidden so they don't clutter the tester's list — but the active
  // line is always kept so a mid-flow toggle never blanks the workspace.
  const allRows = data?.receiving_lines ?? EMPTY_ROWS;
  const rows = hideNoTestLines
    ? allRows.filter((r) => r.id === activeLineId || r.needs_test !== false)
    : allRows;
  // Serial-unit ids across every line of this carton — the atoms an LPN box
  // groups. Drives the "Add to box" control in the header (mint H-{id} +
  // seed the whole carton). Empty until at least one serial is scanned.
  const cartonUnitIds = useMemo(
    () =>
      allRows.flatMap((r) =>
        (r.serials ?? [])
          .map((s) => s.id)
          .filter((id): id is number => typeof id === 'number'),
      ),
    [allRows],
  );
  // Inline item-description (Zoho line desc). The notes icon toggles the row's
  // meta display between (a) the condition + serial chips and (b) the Zoho item
  // description, in the same slot — `descShown` holds the line whose description
  // is currently swapped in. Clicking the shown description opens `descEdit`, an
  // inline editor whose green check saves to receiving_lines.zoho_notes and
  // pushes the same text to the linked Zoho PO line item description.
  const [descShown, setDescShown] = useState<number | null>(null);
  const [descEdit, setDescEdit] = useState<{ id: number; draft: string } | null>(null);
  const [descSavingLineId, setDescSavingLineId] = useState<number | null>(null);
  const descInputRef = useRef<HTMLInputElement>(null);
  const rowBodyCollapse = useMotionPresence(framerPresence.collapseHeight);
  const rowBodyTransition = useMotionTransition(PO_LINE_BODY_COLLAPSE);
  const rowLayoutTransition = useMotionTransition(PO_LINE_LAYOUT_SPRING);
  const chevronTransition = useMotionTransition(framerTransition.stationChevron);

  function zohoSkipNote(zoho?: { skipped?: string }): string | undefined {
    switch (zoho?.skipped) {
      case 'no_zoho_link':
        return 'Saved locally — no Zoho PO link on this line.';
      case 'no_line_item_id':
        return 'Saved locally — sync with Zoho first.';
      case 'po_not_editable':
        return 'Saved locally — Zoho PO is not editable.';
      default:
        return undefined;
    }
  }

  useEffect(() => {
    if (descShown == null) return;
    requestAnimationFrame(() => {
      const el = descInputRef.current;
      if (!el) return;
      const len = el.value.length;
      el.focus();
      el.setSelectionRange(len, len);
      el.scrollLeft = el.scrollWidth;
    });
  }, [descShown, descEdit?.id]);
  const saveItemDesc = async (lineId: number) => {
    if (!descEdit || descEdit.id !== lineId || descSavingLineId != null) return;
    const next = descEdit.draft.trim() || null;
    setDescSavingLineId(lineId);
    onItemDescFeedback?.(null);
    try {
      const res = await fetch(`/api/receiving/lines/${lineId}/zoho-note`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zoho_notes: next }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        zoho?: { patched?: boolean; skipped?: string };
      } | null;
      if (res.ok) {
        queryClient.setQueryData<ApiResponse>(queryKey, (prev) =>
          prev?.receiving_lines
            ? {
                ...prev,
                receiving_lines: prev.receiving_lines.map((r) =>
                  r.id === lineId ? ({ ...r, zoho_notes: next } as ReceivingLineRow) : r,
                ),
              }
            : prev,
        );
        setDescEdit({ id: lineId, draft: next ?? '' });
        onItemDescSaved?.(lineId, next);
        onItemDescFeedback?.({
          tone: 'emerald',
          headline: next ? 'Item description updated' : 'Item description cleared',
          items: next ? [next] : [],
          note: data?.zoho?.patched ? undefined : zohoSkipNote(data?.zoho),
          at: Date.now(),
        });
        queryClient.invalidateQueries({ queryKey });
      } else {
        onItemDescFeedback?.({
          tone: 'amber',
          headline: 'Could not save item description',
          items: [],
          note: data?.error?.trim() || 'Save failed',
          at: Date.now(),
        });
      }
    } catch {
      onItemDescFeedback?.({
        tone: 'amber',
        headline: 'Could not save item description',
        items: [],
        note: 'Save failed',
        at: Date.now(),
      });
    } finally {
      setDescSavingLineId(null);
    }
  };

  // Always render — even for single-line POs the row layout (title, qty,
  // sku, price, condition, serial chip) is the canonical context display the
  // workspace expects above the body.
  if (rows.length === 0) return null;

  // Embedded → bare wrapper (the POUnboxingSection card supplies the chrome +
  // the single shared pencil, so the per-card "+" add action is dropped here).
  const Wrapper = embedded ? 'div' : 'section';
  return (
    <Wrapper
      className={
        embedded
          ? 'min-w-0'
          : 'min-w-0 overflow-hidden rounded-2xl bg-surface-card p-4 shadow-sm ring-1 ring-border-soft/60'
      }
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-caption font-bold uppercase tracking-[0.14em] text-text-soft">
          PO items · {rows.length}
        </h3>
        {embedded ? (
          headerRight ?? null
        ) : !readOnly ? (
          <CartonAddAction receivingId={receivingId} unitIds={cartonUnitIds} />
        ) : null}
      </div>
      <LayoutGroup id={`po-lines-${receivingId}`}>
      <ul className="flex min-w-0 flex-col gap-1">
        {rows.map((line) => {
          const isActive = line.id === activeLineId;
          return (
            <motion.li
              key={line.id}
              layout="position"
              transition={rowLayoutTransition}
              aria-current={isActive ? 'true' : undefined}
              className={`relative min-w-0 overflow-hidden rounded-xl border transition-colors ${
                isActive
                  ? 'border-blue-300 bg-blue-50/60'
                  : 'border-border-soft bg-surface-card hover:bg-surface-hover'
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
                className={`w-full min-w-0 px-3 pb-2 pt-1 text-left ${
                  !readOnly && !isActive ? 'cursor-pointer' : ''
                }`}
              >
                {/* RowTitle contract: disclosure chevron in a fixed track on the
                    title row; meta chips indent under the title text (META_COL),
                    not under the chevron — same layout as ReceivingLineOrderRow. */}
                <div className="flex min-w-0 items-center">
                  {!readOnly ? (
                    <span
                      className={cn(
                        'flex shrink-0 items-center justify-center',
                        META_COL.dotTrackWide,
                      )}
                    >
                      {isActive ? (
                        // Active row: the chevron is a real toggle — click to
                        // collapse/expand the row body (condition pills, unit
                        // rows). Essential on multi-qty lines where the expanded
                        // body is taller than the viewport.
                        <motion.button
                          type="button"
                          aria-expanded={!activeCollapsed}
                          aria-label={
                            activeCollapsed ? 'Expand item details' : 'Collapse item details'
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveCollapsed((v) => !v);
                          }}
                          animate={{ rotate: activeCollapsed ? -90 : 0 }}
                          transition={chevronTransition}
                          className="ds-raw-button flex items-center justify-center rounded-md p-0.5 text-text-faint transition-colors hover:bg-blue-100 hover:text-text-muted"
                        >
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                        </motion.button>
                      ) : (
                        <ChevronDown
                          className="h-3.5 w-3.5 -rotate-90 text-text-faint transition-transform"
                          aria-hidden
                        />
                      )}
                    </span>
                  ) : null}
                  {/* Title is sourced from the listing/PO line — read-only. No
                      inline edit: the operator shouldn't retype the listing title.
                      ds-allow-title: native tooltip shows full value when truncated */}
                  <p
                    className="min-w-0 flex-1 truncate text-label font-bold text-text-default"
                    title={line.item_name ?? undefined}
                  >
                    {line.item_name || line.sku || `Line #${line.id}`}
                  </p>
                  {!readOnly ? (
                    <HoverTooltip label="Toggle item description (Zoho)" asChild>
                      <IconButton
                        ariaLabel="Toggle item description"
                        aria-pressed={descShown === line.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          const opening = descShown !== line.id;
                          const next = opening ? line.id : null;
                          setDescShown(next);
                          setDescEdit(
                            next == null ? null : { id: line.id, draft: line.zoho_notes ?? '' },
                          );
                          onItemDescFeedback?.(null);
                          if (opening && isActive) setActiveCollapsed(false);
                        }}
                        className={`group -m-1 flex shrink-0 items-center justify-center rounded-md p-1 transition-colors hover:bg-blue-100 ${
                          descShown === line.id ? 'bg-blue-100' : ''
                        }`}
                        icon={
                          <FileText
                            className={`h-3.5 w-3.5 ${
                              descShown === line.id
                                ? 'text-blue-600'
                                : 'text-text-faint group-hover:text-text-muted'
                            }`}
                            aria-hidden
                          />
                        }
                      />
                    </HoverTooltip>
                  ) : null}
                </div>
                {/* Meta row — indented to title column. No `truncate` on chips:
                    `flex flex-wrap` wraps badges; `overflow: hidden` would clip the
                    SerialChipWithMenu dropdown (not portaled). */}
                <div
                  className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1"
                  style={{ paddingLeft: readOnly ? undefined : META_COL.indentWide }}
                >
                    {readOnly ? (
                      // Triage read-only: scanned qty (1/1, matching the sidebar)
                      // in blue. The SKU/condition copy chips still render below.
                      <ScannedBadge expected={line.quantity_expected} />
                    ) : (
                      <ProgressBadge
                        received={line.quantity_received}
                        expected={line.quantity_expected}
                      />
                    )}
                    {(line.sku || '').trim() ? (
                      <>
                        <span aria-hidden className="text-micro text-text-faint">·</span>
                        <SkuScanRefChip
                          value={line.sku as string}
                          display={getLast4(line.sku)}
                        />
                      </>
                    ) : null}
                    {line.unit_price != null && Number(line.unit_price) > 0 ? (
                      <>
                        <span aria-hidden className="text-micro text-text-faint">·</span>
                        <UnitPriceChip amount={line.unit_price} />
                      </>
                    ) : null}
                    <span aria-hidden className="text-micro text-text-faint">·</span>
                    <ConditionGradeChip
                      grade={
                        isActive && activeConditionOverride
                          ? activeConditionOverride
                          : line.condition_grade
                      }
                    />
                    {Array.isArray(line.serials) && line.serials.length > 0 ? (
                      <>
                        <span aria-hidden className="text-micro text-text-faint">·</span>
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
              {/* Active row only — the 2nd row. By default it holds the
                  condition pills + serial adder (activeRowSlot). The notes icon
                  toggles this same row to the Zoho item-description editor
                  (descShown) — full-width entry, green check all the way right.
                  Hidden while the chevron has collapsed the row. Read-only
                  (triage) never renders this body — `activeRowSlot` returns null
                  there, which would otherwise leave a stray empty `border-t`. */}
              {!readOnly && isActive && (activeRowSlot || descShown === line.id) ? (
                <motion.div
                  initial={false}
                  layout="position"
                  animate={
                    activeCollapsed
                      ? rowBodyCollapse.exit
                      : rowBodyCollapse.animate
                  }
                  transition={rowBodyTransition}
                  className="min-w-0 overflow-hidden border-t border-blue-200/60"
                  aria-hidden={activeCollapsed}
                >
                  <div className="min-w-0 px-3 pb-2 pt-1">
                    {descShown === line.id ? (
                      <div className="space-y-1">
                        <p className="text-micro font-bold uppercase tracking-widest text-text-soft">
                          Item description
                        </p>
                        <div className="flex h-10 items-stretch gap-2">
                          <input
                            ref={descInputRef}
                            value={descEdit?.draft ?? ''}
                            onChange={(e) => {
                              setDescEdit({ id: line.id, draft: e.target.value });
                              onItemDescFeedback?.(null);
                            }}
                            placeholder="Zoho line description"
                            onKeyDown={(e) => { if (e.key === 'Enter') void saveItemDesc(line.id); }}
                            className="h-10 min-w-0 flex-1 rounded-xl border border-border-default bg-surface-card px-3 text-caption normal-case tracking-normal text-text-default focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                          />
                          <HoverTooltip label="Save item description" asChild>
                            <IconButton
                              ariaLabel="Save item description"
                              onClick={() => void saveItemDesc(line.id)}
                              disabled={descSavingLineId === line.id}
                              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white ring-1 ring-inset ring-emerald-700 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                              icon={<Check className="h-4 w-4" aria-hidden />}
                            />
                          </HoverTooltip>
                        </div>
                      </div>
                    ) : typeof activeRowSlot === 'function'
                      ? activeRowSlot({ serials: line.serials ?? [] })
                      : activeRowSlot}
                  </div>
                </motion.div>
              ) : null}
            </motion.li>
          );
        })}
      </ul>
      </LayoutGroup>
    </Wrapper>
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
          ...(sel.sku_platform_id_row != null && sel.sku_platform_id_row > 0
            ? { sku_platform_id_row: sel.sku_platform_id_row }
            : {}),
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
      <HoverTooltip label="Edit carton items — off-PO item, web result, or a handling-unit box" asChild>
        <IconButton
          ariaLabel="Edit carton items"
          onClick={() => setOpen(true)}
          className="flex h-6 w-6 items-center justify-center rounded-xl bg-blue-600 transition-colors hover:bg-blue-700"
          icon={<Pencil className="h-3.5 w-3.5 text-white" />}
        />
      </HoverTooltip>
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

/** Scanned-qty badge for read-only (triage) rows. A door scan brings the WHOLE
 *  carton in, so scanned == expected (e.g. 1/1) — the same semantics the sidebar
 *  Prioritize/Triage rail renders. Distinct from {@link ProgressBadge}'s
 *  received count (which is 0 until the carton is unboxed, the "0/1" bug). */
function ScannedBadge({ expected }: { expected: number | null }) {
  return (
    <span className={cn(qtyProgress, 'normal-case tracking-normal text-blue-600')}>
      {expected ?? 1}/{expected ?? '?'}
    </span>
  );
}

/** Exported for UnmatchedItemsSection so unfound line rows render the exact
 *  same qty/condition meta as matched PO items. */
export function ProgressBadge({ received, expected }: { received: number; expected: number | null }) {
  const qtyClass = cn(qtyProgress, 'normal-case tracking-normal');
  if (expected == null || expected <= 0) {
    return <span className={cn(qtyClass, 'text-text-soft')}>{received} received</span>;
  }
  const done = received >= expected;
  return (
    <span className={cn(qtyClass, done ? 'text-emerald-600/80' : 'text-text-soft')}>
      {received}/{expected}
    </span>
  );
}

