'use client';

/**
 * SwimlaneBoard — the reusable "bubble-list pipeline" board. Each lane is a
 * rounded bubble card; inside it the consuming surface renders its OWN real
 * table rows (via {@link SwimlaneBoardProps.renderLaneBody}), scrolled
 * VERTICALLY only. This is the generalization of the original Unshipped shelf
 * board: it owns ALL the board mechanics — the 40px header band, the 1/2/3-up
 * column toggle, drag-to-reorder lanes (@dnd-kit), drag-to-resize a lane body,
 * per-lane sort menu, per-lane date filter, and cross-device persistence — and
 * stays agnostic about WHAT a row is. A surface supplies:
 *
 *   - `lanes`        the lane model (id/label/dot/description/icon), canonical order
 *   - `bucket(row)`  pure derivation of a row's lane (never assigned)
 *   - `sortOptions`  the sort vocabulary + labels for the per-lane menu
 *   - `getRowDate`   (optional) the field the per-lane date picker filters on
 *   - `renderLaneBody` the surface's own embedded table (header suppressed)
 *   - `prefsKey`     which `staff_preferences` board bag to read/write
 *
 * Persistence: column layout, lane order, and per-lane sort/expand/height/range
 * persist per staffer via `useStaffPreferences` under `prefs[prefsKey]`, so the
 * view follows the operator across devices. Lane ids + sort ids round-trip as
 * open strings; this component is the SoT that validates them on hydrate and
 * falls back to the canonical lane order / default sort for anything unknown.
 *
 * Column visibility is owned by the consumer: wrap `<SwimlaneBoard>` in your
 * `TableColumnConfigProvider` and pass `<ColumnConfigButton/>` as
 * `headerStartSlot` — the button renders inside the header band but the provider
 * stays outside, so every embedded lane table honors the same hidden-key set.
 *
 * Add a lane → add it to `lanes` + (optionally) the persisted order; the bubble
 * appears with no other change. Add a board → define a new `prefsKey` and a
 * lanes/bucket/renderLaneBody triple; no schema change (see BOARD_PREFS).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { startOfDay, endOfDay } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import * as Popover from '@radix-ui/react-popover';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowUpDown, Check, ChevronDown, ChevronUp, ColumnsOne, ColumnsThree, ColumnsTwo, GripVertical } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { DateRangePickerField } from '@/design-system/components/DateRangePickerField';
import { useStaffPreferences } from '@/hooks/useStaffPreferences';
import type { BoardLanePref, BoardPrefs, BoardPrefsKey } from '@/lib/neon/staff-preferences-queries';
import type { StaffPreferencesPutBody } from '@/lib/schemas/staff-preferences';

/** One lane in the board. `dot` is a Tailwind bg class; `icon` is paired with the label. */
export interface SwimlaneLaneDef<LaneId extends string> {
  id: LaneId;
  label: string;
  /** Tailwind bg class for the status dot (from the surface's state-meta SoT). */
  dot: string;
  /** One-line plain-English meaning — the dot's hover tooltip. */
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Tailwind text class for the lane header icon (defaults to gray). */
  iconClass?: string;
}

/** A selectable sort for the per-lane sort menu. */
export interface SwimlaneSortOption<SortId extends string> {
  id: SortId;
  label: string;
}

/** Context handed to the consumer's lane-body renderer (the embedded table). */
export interface SwimlaneLaneBodyContext<Row, LaneId extends string, SortId extends string> {
  laneId: LaneId;
  laneLabel: string;
  rows: Row[];
  sort: SortId;
  /** Tailwind max-height utility for the body when no drag-resize px is set. */
  maxBodyHeightClass?: string;
  /** Explicit px cap from a drag-resize; wins over `maxBodyHeightClass`. */
  maxBodyHeightPx?: number;
  /** Stacked (1-up) layout: the body should grow to its full content with NO
   *  internal scroll/cap so the board's single scroll region owns the wheel
   *  (no per-lane scroll trap). The height props are omitted in this mode. */
  growToContent?: boolean;
}

export interface SwimlaneBoardProps<Row, LaneId extends string, SortId extends string> {
  /** Which `staff_preferences` board bag persists this board's layout. */
  prefsKey: BoardPrefsKey;
  /** Lane model, in canonical (default) top→bottom order. */
  lanes: SwimlaneLaneDef<LaneId>[];
  /** Pure: which lane a row belongs to. Never assigned/stored on the row. */
  bucket: (row: Row) => LaneId;
  records: Row[];
  /** Highest column count offered in the layout toggle (1–3, default 3). Set to
   *  `2` (or `1`) to drop wider layouts for boards with many tall lanes — the
   *  toggle only renders the allowed options and a saved over-cap pref is clamped. */
  maxColumns?: ColumnCount;
  /** Sort vocabulary for the per-lane menu (+ the active label it displays).
   *  Omit to drop the per-lane sort menu entirely (e.g. a board whose embedded
   *  table has a single fixed order). */
  sortOptions?: SwimlaneSortOption<SortId>[];
  /** Default per-lane sort; falls back to the first `sortOptions` entry. */
  defaultSort?: SortId;
  /** @deprecated No longer rendered — the header band shows controls only (no
   *  title/count text). Kept optional for call-site compatibility. */
  title?: string;
  /** @deprecated No longer rendered (see `title`). */
  totalLabel?: string;
  /** Header band start slot (e.g. `<ColumnConfigButton/>`), inside the band. */
  headerStartSlot?: ReactNode;
  /** Header band end slot (e.g. week nav), left of the column toggle. */
  headerEndSlot?: ReactNode;
  /** Rendered in each lane header's control cluster (sort / date / staff), right-aligned. */
  laneHeaderSlot?: ReactNode;
  /** When set, each lane header shows a date-range picker filtering on this field.
   *  Omit to hide per-lane date filtering entirely. */
  getRowDate?: (row: Row) => string | null | undefined;
  /** Render the lane's embedded table (header suppressed, vertical-only). */
  renderLaneBody: (ctx: SwimlaneLaneBodyContext<Row, LaneId, SortId>) => ReactNode;
}

/** Board layout — bubbles stacked 1-up, or laid 2-up / 3-up side by side. */
type ColumnCount = 1 | 2 | 3;
const COLUMN_ITEMS: HorizontalSliderItem[] = [
  { id: '1', label: '1 column', icon: ColumnsOne },
  { id: '2', label: '2 columns', icon: ColumnsTwo },
  { id: '3', label: '3 columns', icon: ColumnsThree },
];

/** `height` is a drag-resized body cap (px); `null` → snap to expanded/collapsed
 *  preset. `range` is this lane's own date-range filter (its header owns the picker). */
type LaneState<SortId extends string> = { sort: SortId; expanded: boolean; height: number | null; range?: DateRange };

/** Resize clamps — keep a lane usably tall but never past the viewport. */
const MIN_LANE_PX = 140;
const maxLanePx = () => Math.round(window.innerHeight * 0.9);

/** Stacked (1-up) collapsed lanes show this many rows as a preview, then a
 *  "Show more" reveals the rest — replaces the internal scrollbar so a stacked
 *  lane never traps the wheel (the board owns the single scroll region). */
const STACKED_COLLAPSED_PREVIEW_ROWS = 6;

/** Serialize a lane for the JSONB prefs bag (Date → ISO; `null` clears a field). */
function serializeLane<SortId extends string>(lane: LaneState<SortId>): BoardLanePref {
  return {
    sort: lane.sort,
    expanded: lane.expanded,
    height: lane.height,
    range: lane.range?.from
      ? { from: lane.range.from.toISOString(), to: (lane.range.to ?? lane.range.from).toISOString() }
      : null,
  };
}

/**
 * Per-lane sort control — a ghost pill that *displays the active sort* (so e.g.
 * "Staff" reads on the button) and opens a menu of every option. Generic over
 * the surface's sort vocabulary.
 */
function LaneSortMenu<SortId extends string>({
  value,
  options,
  onChange,
}: {
  value: SortId;
  options: SwimlaneSortOption<SortId>[];
  onChange: (sort: SortId) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeLabel = options.find((o) => o.id === value)?.label ?? String(value);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {/* ds-raw-button: Radix Popover.Trigger asChild */}
        <button
          type="button"
          aria-label={`Sort: ${activeLabel}`}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 text-eyebrow font-bold uppercase tracking-widest text-gray-600 transition-colors hover:border-blue-300 hover:bg-blue-50/40"
        >
          <ArrowUpDown className="h-3 w-3 text-gray-400" />
          {activeLabel}
          <ChevronDown className="h-3 w-3 text-gray-400" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-dropdown w-36 overflow-hidden rounded-lg border border-gray-200 bg-white p-1 shadow-lg ring-1 ring-black/5 focus:outline-none"
        >
          {options.map((o) => (
            // ds-raw-button: text-left two-state menu/select row
            <button
              key={o.id}
              type="button"
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-caption font-semibold transition-colors ${
                o.id === value ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {o.label}
              {o.id === value ? <Check className="h-3.5 w-3.5" /> : null}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Keep only rows whose date (per `getRowDate`) falls in the picked range. */
function inDateRange<Row>(
  row: Row,
  range: DateRange | undefined,
  getRowDate: (row: Row) => string | null | undefined,
): boolean {
  if (!range?.from) return true;
  const src = getRowDate(row);
  const t = src ? new Date(src).getTime() : NaN;
  if (!Number.isFinite(t)) return false;
  const from = startOfDay(range.from).getTime();
  const to = endOfDay(range.to ?? range.from).getTime();
  return t >= from && t <= to;
}

interface SwimlaneBubbleProps<Row, LaneId extends string, SortId extends string> {
  lane: SwimlaneLaneDef<LaneId>;
  rows: Row[];
  colCount: ColumnCount;
  sort: SortId;
  sortOptions: SwimlaneSortOption<SortId>[];
  /** Show the per-lane sort menu (the board passes non-empty `sortOptions`). */
  showSortMenu: boolean;
  expanded: boolean;
  /** Drag-resized body cap (px); null → snap to the expanded/collapsed preset. */
  height: number | null;
  /** This lane's own date-range filter (its header owns the picker). */
  range: DateRange | undefined;
  /** Show the per-lane date picker (the board passes `getRowDate`). */
  showDateFilter: boolean;
  /** Optional board-level control rendered beside sort/date (e.g. staff filter). */
  laneHeaderSlot?: ReactNode;
  onSortChange: (sort: SortId) => void;
  onRangeChange: (range: DateRange | undefined) => void;
  onToggleExpanded: () => void;
  /** Commit a drag-resized body height (px) for this lane. */
  onResize: (px: number) => void;
  renderBody: (ctx: SwimlaneLaneBodyContext<Row, LaneId, SortId>) => ReactNode;
}

function SwimlaneBubble<Row, LaneId extends string, SortId extends string>({
  lane,
  rows,
  colCount,
  sort,
  sortOptions,
  showSortMenu,
  expanded,
  height,
  range,
  showDateFilter,
  laneHeaderSlot,
  onSortChange,
  onRangeChange,
  onToggleExpanded,
  onResize,
  renderBody,
}: SwimlaneBubbleProps<Row, LaneId, SortId>) {
  const Icon = lane.icon;
  // Narrower multi-column cards get a shorter default cap to keep the row tidy.
  const presetMaxClass = !expanded
    ? 'max-h-72'
    : colCount === 1
      ? 'max-h-[70vh]'
      : colCount === 2
        ? 'max-h-[56vh]'
        : 'max-h-[48vh]';

  // Stacked (1-up) lanes grow to content and let the BOARD own the scroll, so the
  // wheel is never trapped per lane. Collapse caps the preview to N rows + a
  // "Show more" toggle (replacing the inner scrollbar). Grid (2/3-up) lanes keep
  // the capped, internally-scrolling body where side-by-side columns want it.
  const stacked = colCount === 1;
  const bodyRows = stacked && !expanded ? rows.slice(0, STACKED_COLLAPSED_PREVIEW_ROWS) : rows;
  const canToggleStacked = stacked && rows.length > STACKED_COLLAPSED_PREVIEW_ROWS;

  // Drag-to-resize the body from the bottom edge. `localHeight` drives the cap
  // live during a drag; it commits to staff prefs on pointer-up. Null → preset.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [localHeight, setLocalHeight] = useState<number | null>(height);
  useEffect(() => setLocalHeight(height), [height]);
  const dragRef = useRef<{ startY: number; startH: number; latest: number } | null>(null);

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const startH = bodyRef.current?.getBoundingClientRect().height ?? 320;
    dragRef.current = { startY: e.clientY, startH, latest: startH };
    setLocalHeight(startH);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const next = Math.round(Math.min(maxLanePx(), Math.max(MIN_LANE_PX, d.startH + (e.clientY - d.startY))));
    d.latest = next;
    setLocalHeight(next);
  };
  const onResizeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d) onResize(d.latest);
  };

  // Drag-to-reorder the lane (the whole bubble) — order persists per staffer.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lane.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <section
      ref={setNodeRef}
      style={style}
      // Stacked lanes use `overflow-clip` (clips for rounded corners but is NOT a
      // scroll container) so the body's sticky DateGroupHeader escapes up to the
      // board scroll region and sticks at the top of the page. Grid lanes keep
      // `overflow-hidden` (their body scrolls internally, sticking within the lane).
      className={`flex flex-col rounded-xl border border-gray-200 bg-white ${
        stacked ? 'overflow-clip' : 'overflow-hidden'
      }`}
    >
      {/* Header — ONE row: identity (drag handle + dot + icon + label + count)
          on the left, this lane's controls (sort menu + date filter) pushed to
          the right. The label truncates so the controls never wrap to a 2nd row. */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-2.5 py-1.5">
        {/* ds-raw-button: dnd-kit drag handle (spreads listeners; active:scale would fight drag) */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder ${lane.label} lane`}
          className="-ml-1 flex-shrink-0 cursor-grab text-gray-300 transition hover:text-gray-500 active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <HoverTooltip label={lane.description} focusable={false}>
          <span className={`h-2 w-2 shrink-0 rounded-full ${lane.dot}`} />
        </HoverTooltip>
        <Icon className={`h-3.5 w-3.5 shrink-0 ${lane.iconClass ?? 'text-gray-400'}`} />
        <h3 className="truncate text-eyebrow font-black uppercase tracking-widest text-gray-500">{lane.label}</h3>
        <span className="shrink-0 text-eyebrow font-black uppercase tracking-widest text-gray-400">{rows.length}</span>
        {showSortMenu || showDateFilter || laneHeaderSlot ? (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {laneHeaderSlot}
            {showSortMenu ? <LaneSortMenu value={sort} options={sortOptions} onChange={onSortChange} /> : null}
            {showDateFilter ? (
              <DateRangePickerField value={range} onChange={onRangeChange} placeholder="All dates" className="h-7 w-auto" />
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Body — the consumer's real table, header suppressed, vertical-only scroll.
          The renderer should size to content up to a cap (preset class, or the
          drag-resized px) so a short lane leaves no trailing whitespace. */}
      <div ref={bodyRef}>
        {renderBody({
          laneId: lane.id,
          laneLabel: lane.label,
          rows: bodyRows,
          sort,
          // Stacked lanes impose no height cap (the board scrolls); grid lanes keep
          // their drag-px or preset cap.
          maxBodyHeightClass: stacked ? undefined : localHeight == null ? presetMaxClass : undefined,
          maxBodyHeightPx: stacked ? undefined : (localHeight ?? undefined),
          growToContent: stacked,
        })}
      </div>

      {rows.length > 0 ? (
        <>
          {/* Footer toggle — grid lanes snap the height preset; stacked lanes flip
              the row preview (only shown when there are more rows to reveal). */}
          {(!stacked || canToggleStacked) ? (
            // ds-raw-button: full-width two-state expand/collapse disclosure toggle
            <button
              type="button"
              onClick={onToggleExpanded}
              className="flex w-full items-center justify-center gap-1 border-t border-gray-100 py-1 text-eyebrow font-black uppercase tracking-widest text-gray-500 transition hover:bg-gray-50"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" /> Show less
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" /> Show more
                </>
              )}
            </button>
          ) : null}
          {/* Drag handle — resize the capped body. Hidden for stacked lanes, which
              grow to content (no internal height to resize). */}
          {!stacked ? (
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={`Drag to resize ${lane.label} lane`}
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            className="group flex h-2.5 w-full shrink-0 cursor-ns-resize touch-none items-center justify-center border-t border-gray-100 bg-gray-50/60 transition hover:bg-gray-100"
          >
            <span className="h-1 w-8 rounded-full bg-gray-300 transition group-hover:bg-gray-400" />
          </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function SwimlaneBoard<Row, LaneId extends string, SortId extends string>({
  prefsKey,
  lanes,
  bucket,
  records,
  maxColumns = 3,
  sortOptions,
  defaultSort,
  headerStartSlot,
  headerEndSlot,
  laneHeaderSlot,
  getRowDate,
  renderLaneBody,
}: SwimlaneBoardProps<Row, LaneId, SortId>) {
  const { prefs, update } = useStaffPreferences();

  // Only offer column layouts up to `maxColumns` (e.g. a 7-lane pipeline drops
  // the cramped 3-up option). The toggle hides the rest; clamping below keeps a
  // stale saved/over-cap value from selecting a hidden layout.
  const columnItems = useMemo(() => COLUMN_ITEMS.filter((it) => Number(it.id) <= maxColumns), [maxColumns]);

  /** Canonical lane order + the set of valid lane ids (for hydrate validation). */
  const canonicalOrder = useMemo(() => lanes.map((l) => l.id), [lanes]);
  const laneById = useMemo(() => {
    const m = new Map<LaneId, SwimlaneLaneDef<LaneId>>();
    for (const l of lanes) m.set(l.id, l);
    return m;
  }, [lanes]);
  const showSortMenu = Boolean(sortOptions && sortOptions.length > 0);
  const effectiveDefaultSort = (defaultSort ?? sortOptions?.[0]?.id) as SortId;
  const validSorts = useMemo(() => new Set((sortOptions ?? []).map((o) => o.id)), [sortOptions]);
  const defaultLaneMap = useMemo(() => {
    const m = {} as Record<LaneId, LaneState<SortId>>;
    for (const l of lanes) m[l.id] = { sort: effectiveDefaultSort, expanded: true, height: null, range: undefined };
    return m;
  }, [lanes, effectiveDefaultSort]);

  const [columns, setColumns] = useState<ColumnCount>(1);
  const [laneMap, setLaneMap] = useState<Record<LaneId, LaneState<SortId>>>(defaultLaneMap);
  // Drag-reordered lane order (top → bottom). Defaults to the canonical order.
  const [order, setOrder] = useState<LaneId[]>(canonicalOrder);

  // dnd-kit: a small drag threshold so a click on the handle doesn't reorder.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Latest saved board prefs, used to build a full object for the shallow merge.
  const boardPrefs: BoardPrefs = prefs?.[prefsKey] ?? {};
  const persistBoard = (next: BoardPrefs) =>
    update({ [prefsKey]: next } as unknown as StaffPreferencesPutBody);

  // Hydrate UI state from saved prefs once they arrive (cross-device sticky).
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || !prefs) return;
    hydrated.current = true;
    const b = prefs[prefsKey];
    if (!b) return;
    if ((b.columns === 1 || b.columns === 2 || b.columns === 3) && b.columns <= maxColumns) setColumns(b.columns);
    if (Array.isArray(b.order) && b.order.length > 0) {
      const valid = b.order.filter((s): s is LaneId => laneById.has(s as LaneId));
      if (valid.length > 0) setOrder(valid);
    }
    if (b.lanes) {
      setLaneMap((cur) => {
        const next = { ...cur };
        for (const id of canonicalOrder) {
          const saved = b.lanes?.[id];
          if (saved) {
            next[id] = {
              sort: saved.sort && validSorts.has(saved.sort as SortId) ? (saved.sort as SortId) : cur[id].sort,
              expanded: saved.expanded ?? cur[id].expanded,
              height: saved.height === undefined ? cur[id].height : saved.height,
              range: saved.range?.from
                ? { from: new Date(saved.range.from), to: saved.range.to ? new Date(saved.range.to) : undefined }
                : undefined,
            };
          }
        }
        return next;
      });
    }
  }, [prefs]);

  const changeColumns = (next: ColumnCount) => {
    const clamped = Math.min(next, maxColumns) as ColumnCount;
    setColumns(clamped);
    persistBoard({ ...boardPrefs, columns: clamped });
  };

  const mutateLane = (id: LaneId, patch: Partial<LaneState<SortId>>) => {
    const nextLane = { ...laneMap[id], ...patch };
    setLaneMap((cur) => ({ ...cur, [id]: nextLane }));
    persistBoard({ ...boardPrefs, lanes: { ...(boardPrefs.lanes ?? {}), [id]: serializeLane(nextLane) } });
  };

  // Resolve the render order: saved order first (validated), any lane missing
  // from it appended in the canonical order so a partial list is safe.
  const effectiveOrder = useMemo(() => {
    const seen = new Set<LaneId>();
    const result: LaneId[] = [];
    for (const s of order) {
      if (laneById.has(s) && !seen.has(s)) {
        seen.add(s);
        result.push(s);
      }
    }
    for (const s of canonicalOrder) if (!seen.has(s)) result.push(s);
    return result;
  }, [order, laneById, canonicalOrder]);

  // Drag-end → reorder the lanes and persist the new order per staffer.
  const reorderLanes = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = effectiveOrder.indexOf(active.id as LaneId);
    const newIdx = effectiveOrder.indexOf(over.id as LaneId);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(effectiveOrder, oldIdx, newIdx);
    setOrder(next);
    persistBoard({ ...boardPrefs, order: next });
  };

  const lanesRows = useMemo(() => {
    const buckets = {} as Record<LaneId, Row[]>;
    for (const id of canonicalOrder) buckets[id] = [];
    for (const r of records) {
      const id = bucket(r);
      (buckets[id] ?? (buckets[id] = [])).push(r);
    }
    // Each lane filters its own bucket by its own header date picker.
    const out = {} as Record<LaneId, Row[]>;
    for (const id of canonicalOrder) {
      const rng = laneMap[id]?.range;
      out[id] = rng?.from && getRowDate ? buckets[id].filter((r) => inDateRange(r, rng, getRowDate)) : buckets[id];
    }
    return out;
  }, [records, laneMap, bucket, canonicalOrder, getRowDate]);

  const isGrid = columns >= 2;
  const gridClass =
    columns === 3
      ? 'grid grid-cols-3 items-start gap-4'
      : columns === 2
        ? 'grid grid-cols-2 items-start gap-4'
        : 'space-y-4';

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-gray-50">
      {/* Dedicated 40px right-panel header — matches the sidebar master-nav modes
          band (h-[40px] + border + flush controls). Sits ABOVE the scroll region
          so each bubble's sticky `DateGroupHeader` still docks correctly. */}
      <div className="flex h-[40px] shrink-0 items-center gap-3 border-b border-gray-300 bg-white/90 px-3 backdrop-blur-md">
        {headerStartSlot}
        <div className="ml-auto flex items-center gap-2">
          {columnItems.length > 1 ? (
            <HorizontalButtonSlider
              items={columnItems}
              value={String(columns)}
              onChange={(id) => changeColumns(Number(id) as ColumnCount)}
              variant="nav"
              navIconOnly
              dense
              aria-label="Board columns"
            />
          ) : null}
          {/* Column-config button sits at the far right (most top-right). */}
          {headerEndSlot}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorderLanes}>
          <SortableContext items={effectiveOrder} strategy={isGrid ? rectSortingStrategy : verticalListSortingStrategy}>
            <div className={gridClass}>
              {effectiveOrder.map((id) => {
                const lane = laneById.get(id);
                if (!lane) return null;
                const laneState = laneMap[id] ?? defaultLaneMap[id];
                return (
                  <SwimlaneBubble
                    key={id}
                    lane={lane}
                    rows={lanesRows[id] ?? []}
                    colCount={columns}
                    sort={laneState.sort}
                    sortOptions={sortOptions ?? []}
                    showSortMenu={showSortMenu}
                    expanded={laneState.expanded}
                    height={laneState.height}
                    range={laneState.range}
                    showDateFilter={Boolean(getRowDate)}
                    laneHeaderSlot={laneHeaderSlot}
                    onSortChange={(s) => mutateLane(id, { sort: s })}
                    onRangeChange={(r) => mutateLane(id, { range: r })}
                    // Snapping to a preset clears any drag-resized height.
                    onToggleExpanded={() => mutateLane(id, { expanded: !laneState.expanded, height: null })}
                    onResize={(px) => mutateLane(id, { height: px })}
                    renderBody={renderLaneBody}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
