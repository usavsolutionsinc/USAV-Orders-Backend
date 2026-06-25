'use client';

/**
 * Unshipped · Shelf Board — the bubble-list pipeline view of the fulfillment
 * queue. Each fulfillment state is a rounded "bubble" card; inside it are the
 * real `OrdersQueueTable` rows (same exact component the dense table uses),
 * scrolled VERTICALLY only — no horizontal scroll, no bottom scrollbar.
 *
 * The board header is a dedicated 40px in-panel band (title + total + a staff
 * filter + an icon-only 1/2/3-column toggle) that matches the sidebar master-nav
 * modes band, sitting ABOVE the scroll region so each bubble's sticky chip date
 * header still docks correctly. The staff filter writes the canonical `?staff=`
 * param (whole-board, via the unshipped query). Each bubble owns its OWN header
 * controls — a sort menu (which displays the active sort, e.g. "Staff") on the
 * left and a date-range filter on the right — over a body
 * that sizes to content up to a cap (`autoHeight` → no trailing whitespace), a
 * footer that snaps to the expanded/collapsed preset, and a bottom drag handle to
 * resize the body.
 *
 * Lanes can be drag-reordered (whole bubble, via @dnd-kit) and drag-resized from
 * the bottom edge; column layout, lane order, and per-lane sort/expand/height/range
 * persist per staffer via `useStaffPreferences` (`unshippedBoard`), so the view
 * follows the operator across devices.
 *
 * Data-driven: lanes derive from FULFILLMENT_STATE_META in SHELF_ORDER; a card's
 * lane is computed by deriveFulfillmentState (never assigned); dot colors come
 * from the state meta. Add a state to the meta + SHELF_ORDER → a new bubble.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { startOfDay, endOfDay } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import * as Popover from '@radix-ui/react-popover';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, ArrowUpDown, Check, ChevronDown, ChevronUp, Clock, ColumnsOne, ColumnsThree, ColumnsTwo, GripVertical, User } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { DateRangePickerField } from '@/design-system/components/DateRangePickerField';
import { OrdersQueueTable } from '@/components/dashboard/OrdersQueueTable';
import { ORDERS_QUEUE_SORTS, ORDERS_QUEUE_SORT_LABEL, type OrdersQueueSort } from '@/components/dashboard/orders-queue/helpers';
import { DASHBOARD_ORDERS_SELECTION_SCOPE } from '@/lib/selection/dashboard-scopes';
import { useStaffFilter } from '@/hooks/useStaffFilter';
import { useStaffPreferences } from '@/hooks/useStaffPreferences';
import type { StaffPreferences } from '@/lib/neon/staff-preferences-queries';
import {
  deriveFulfillmentState,
  FULFILLMENT_STATE_META,
  type FulfillmentState,
} from '@/lib/unshipped-state';
import type { ShippedOrder } from '@/types/orders';

/** Lane order, top → bottom = progress through the queue; Blocked (exception) last. */
const SHELF_ORDER: FulfillmentState[] = ['PENDING', 'TESTED', 'BLOCKED'];

/** Paired icon per state — structural, sits next to the lane title. */
const STATE_ICON: Record<FulfillmentState, React.ComponentType<{ className?: string }>> = {
  PENDING: Clock,
  TESTED: Check,
  BLOCKED: AlertTriangle,
};

/** Board layout — bubbles stacked 1-up, or laid 2-up / 3-up side by side.
 *  Icon-only: a framed rect split into N columns (no text, hover shows the label). */
type ColumnCount = 1 | 2 | 3;
const COLUMN_ITEMS: HorizontalSliderItem[] = [
  { id: '1', label: '1 column', icon: ColumnsOne },
  { id: '2', label: '2 columns', icon: ColumnsTwo },
  { id: '3', label: '3 columns', icon: ColumnsThree },
];

/** Sort labels shared with the dense table; the per-lane menu displays the active one. */
const SORT_LABEL = ORDERS_QUEUE_SORT_LABEL;

type BoardPrefs = NonNullable<StaffPreferences['unshippedBoard']>;
/** `height` is a drag-resized body cap (px); `null` → snap to expanded/collapsed
 *  preset. `range` is this lane's own date-range filter (its header owns the picker). */
type LaneState = { sort: OrdersQueueSort; expanded: boolean; height: number | null; range?: DateRange };
type LaneMap = Record<FulfillmentState, LaneState>;

const DEFAULT_LANE: LaneState = { sort: 'priority', expanded: true, height: null, range: undefined };
/** Resize clamps — keep a lane usably tall but never past the viewport. */
const MIN_LANE_PX = 140;
const maxLanePx = () => Math.round(window.innerHeight * 0.9);
const defaultLaneMap = (): LaneMap => ({
  PENDING: { ...DEFAULT_LANE },
  TESTED: { ...DEFAULT_LANE },
  BLOCKED: { ...DEFAULT_LANE },
});

/** Runtime-only fields the queue rows carry but ShippedOrder doesn't type. */
type FulfillmentRow = ShippedOrder & {
  has_tech_scan?: boolean | null;
  out_of_stock?: string | null;
};

function rowState(row: FulfillmentRow): FulfillmentState {
  return deriveFulfillmentState({
    hasTechScan: Boolean(row.has_tech_scan),
    outOfStock: row.out_of_stock,
  });
}

/** Serialize a lane for the JSONB prefs bag (Date → ISO; `null` clears a field). */
function serializeLane(lane: LaneState) {
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
 * Per-lane sort control — a ghost pill that *displays the active sort* (so
 * "Staff" reads on the button) and opens a menu of every option. Replaces the
 * old blind cycle so the staff sort is discoverable in the table header itself.
 */
function LaneSortMenu({ value, onChange }: { value: OrdersQueueSort; onChange: (sort: OrdersQueueSort) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Sort: ${SORT_LABEL[value]}`}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 text-eyebrow font-bold uppercase tracking-widest text-gray-600 transition-colors hover:border-blue-300 hover:bg-blue-50/40"
        >
          <ArrowUpDown className="h-3 w-3 text-gray-400" />
          {SORT_LABEL[value]}
          <ChevronDown className="h-3 w-3 text-gray-400" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-dropdown w-36 overflow-hidden rounded-lg border border-gray-200 bg-white p-1 shadow-lg ring-1 ring-black/5 focus:outline-none"
        >
          {ORDERS_QUEUE_SORTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                onChange(s);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-caption font-semibold transition-colors ${
                s === value ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {SORT_LABEL[s]}
              {s === value ? <Check className="h-3.5 w-3.5" /> : null}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Board-level staff filter — a ghost pill that opens a staff dropdown and writes
 * the canonical `?staff=` param (via {@link useStaffFilter}). The unshipped query
 * already narrows its rows to that staff, so picking one filters every lane at
 * once; "All staff" clears it. Active state reads filled-blue.
 */
function BoardStaffFilter() {
  const { staffId, options, selectedName, setStaff } = useStaffFilter();
  const [open, setOpen] = useState(false);
  const active = staffId != null;
  const label = active ? selectedName || `#${staffId}` : 'All staff';

  const Row = ({ id, name }: { id: number | null; name: string }) => {
    const isActive = id === staffId || (id == null && !active);
    return (
      <button
        type="button"
        onClick={() => {
          setStaff(id);
          setOpen(false);
        }}
        className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-caption font-semibold transition-colors ${
          isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
        }`}
      >
        <span className="truncate">{name}</span>
        {isActive ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
      </button>
    );
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Filter by staff: ${label}`}
          className={`inline-flex h-8 max-w-[160px] shrink-0 items-center gap-1.5 rounded-md border px-2 text-eyebrow font-bold uppercase tracking-widest transition-colors ${
            active
              ? 'border-blue-300 bg-blue-50 text-blue-700'
              : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:bg-blue-50/40'
          }`}
        >
          <User className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-dropdown max-h-[60vh] w-52 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg ring-1 ring-black/5 focus:outline-none"
        >
          <Row id={null} name="All staff" />
          {options.length > 0 ? <div className="my-1 h-px bg-gray-100" /> : null}
          {options.map((o) => (
            <Row key={o.id} id={o.id} name={o.name} />
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Keep only rows whose created/deadline date falls in the picked range. */
function inDateRange(row: ShippedOrder, range: DateRange | undefined): boolean {
  if (!range?.from) return true;
  const src = row.created_at || row.deadline_at;
  const t = src ? new Date(src).getTime() : NaN;
  if (!Number.isFinite(t)) return false;
  const from = startOfDay(range.from).getTime();
  const to = endOfDay(range.to ?? range.from).getTime();
  return t >= from && t <= to;
}

interface ShelfBubbleProps {
  state: FulfillmentState;
  rows: ShippedOrder[];
  loading: boolean;
  searchValue: string;
  colCount: ColumnCount;
  sort: OrdersQueueSort;
  expanded: boolean;
  /** Drag-resized body cap (px); null → snap to the expanded/collapsed preset. */
  height: number | null;
  /** This lane's own date-range filter (its header owns the picker). */
  range: DateRange | undefined;
  onSortChange: (sort: OrdersQueueSort) => void;
  onRangeChange: (range: DateRange | undefined) => void;
  onToggleExpanded: () => void;
  /** Commit a drag-resized body height (px) for this lane. */
  onResize: (px: number) => void;
  onOpenRecord: (record: ShippedOrder) => void;
  onClearSearch: () => void;
  searchEmptyTitle: string;
  searchResultLabel: string;
  clearSearchLabel: string;
}

function ShelfBubble({
  state,
  rows,
  loading,
  searchValue,
  colCount,
  sort,
  expanded,
  height,
  range,
  onSortChange,
  onRangeChange,
  onToggleExpanded,
  onResize,
  onOpenRecord,
  onClearSearch,
  searchEmptyTitle,
  searchResultLabel,
  clearSearchLabel,
}: ShelfBubbleProps) {
  const meta = FULFILLMENT_STATE_META[state];
  const Icon = STATE_ICON[state];
  // Narrower multi-column cards get a shorter default cap to keep the row tidy.
  const presetMaxClass = !expanded
    ? 'max-h-72'
    : colCount === 1
      ? 'max-h-[70vh]'
      : colCount === 2
        ? 'max-h-[56vh]'
        : 'max-h-[48vh]';

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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: state });
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
      className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white"
    >
      {/* Header — identity row (drag handle + dot + icon + label + count) over a
          controls row that owns this lane's own date filter + sort menu. */}
      <div className="border-b border-gray-100">
        <div className="flex items-center gap-2 px-2.5 pt-1.5">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Drag to reorder ${meta.label} lane`}
            className="-ml-1 flex-shrink-0 cursor-grab text-gray-300 transition hover:text-gray-500 active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <HoverTooltip label={meta.description} focusable={false}>
            <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
          </HoverTooltip>
          <Icon className="h-3.5 w-3.5 text-gray-400" />
          <h3 className="truncate text-eyebrow font-black uppercase tracking-widest text-gray-500">{meta.label}</h3>
          <span className="text-eyebrow font-black uppercase tracking-widest text-gray-400">{rows.length}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 pb-1.5 pt-1">
          <LaneSortMenu value={sort} onChange={onSortChange} />
          {/* Date filter pinned to the right of the controls row. */}
          <div className="ml-auto min-w-0">
            <DateRangePickerField value={range} onChange={onRangeChange} placeholder="All dates" className="h-7 w-auto" />
          </div>
        </div>
      </div>

      {/* Body — the real queue table, header suppressed, vertical-only scroll.
          `autoHeight` sizes to content up to a cap (preset class, or the
          drag-resized px) so a short lane leaves no trailing whitespace. */}
      <div ref={bodyRef}>
        <OrdersQueueTable
          hideHeader
          dateHeaderVariant="chip"
          noHorizontalScroll
          autoHeight
          maxBodyHeightClass={localHeight == null ? presetMaxClass : undefined}
          maxBodyHeightPx={localHeight ?? undefined}
          records={rows}
          queueMode="fulfillment"
          sort={sort}
          selectionScope={DASHBOARD_ORDERS_SELECTION_SCOPE}
          loading={loading}
          isRefreshing={false}
          searchValue={searchValue}
          onClearSearch={onClearSearch}
          emptyMessage={`No ${meta.label.toLowerCase()} orders`}
          searchEmptyTitle={searchEmptyTitle}
          searchResultLabel={searchResultLabel}
          clearSearchLabel={clearSearchLabel}
          onOpenRecord={onOpenRecord}
        />
      </div>

      {rows.length > 0 ? (
        <>
          {/* Footer — quick snap to the expanded/collapsed preset. */}
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
          {/* Drag handle — click-hold and drag up/down to resize the body. */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={`Drag to resize ${meta.label} lane`}
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            className="group flex h-2.5 w-full shrink-0 cursor-ns-resize touch-none items-center justify-center border-t border-gray-100 bg-gray-50/60 transition hover:bg-gray-100"
          >
            <span className="h-1 w-8 rounded-full bg-gray-300 transition group-hover:bg-gray-400" />
          </div>
        </>
      ) : null}
    </section>
  );
}

export interface UnshippedShelfBoardProps {
  records: ShippedOrder[];
  loading: boolean;
  searchValue: string;
  onOpenRecord: (record: ShippedOrder) => void;
  onClearSearch: () => void;
  searchEmptyTitle?: string;
  searchResultLabel?: string;
  clearSearchLabel?: string;
}

export function UnshippedShelfBoard({
  records,
  loading,
  searchValue,
  onOpenRecord,
  onClearSearch,
  searchEmptyTitle = 'No orders found',
  searchResultLabel = 'unshipped orders',
  clearSearchLabel = 'Show All Unshipped Orders',
}: UnshippedShelfBoardProps) {
  const { prefs, update } = useStaffPreferences();

  const [columns, setColumns] = useState<ColumnCount>(1);
  const [laneMap, setLaneMap] = useState<LaneMap>(defaultLaneMap);
  // Drag-reordered lane order (top → bottom). Defaults to the canonical order.
  const [order, setOrder] = useState<FulfillmentState[]>(SHELF_ORDER);

  // dnd-kit: a small drag threshold so a click on the handle doesn't reorder.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Latest saved board prefs, used to build a full object for the shallow merge.
  const boardPrefs: BoardPrefs = prefs?.unshippedBoard ?? {};
  const persistBoard = (next: BoardPrefs) => update({ unshippedBoard: next });

  // Hydrate UI state from saved prefs once they arrive (cross-device sticky).
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || !prefs) return;
    hydrated.current = true;
    const b = prefs.unshippedBoard;
    if (!b) return;
    if (b.columns === 1 || b.columns === 2 || b.columns === 3) setColumns(b.columns);
    if (Array.isArray(b.order) && b.order.length > 0) {
      const valid = b.order.filter((s): s is FulfillmentState => SHELF_ORDER.includes(s));
      if (valid.length > 0) setOrder(valid);
    }
    if (b.lanes) {
      setLaneMap((cur) => {
        const next = { ...cur };
        for (const s of SHELF_ORDER) {
          const saved = b.lanes?.[s];
          if (saved) {
            next[s] = {
              sort: saved.sort ?? cur[s].sort,
              expanded: saved.expanded ?? cur[s].expanded,
              height: saved.height === undefined ? cur[s].height : saved.height,
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
    setColumns(next);
    persistBoard({ ...boardPrefs, columns: next });
  };

  const mutateLane = (state: FulfillmentState, patch: Partial<LaneState>) => {
    const nextLane = { ...laneMap[state], ...patch };
    setLaneMap((cur) => ({ ...cur, [state]: nextLane }));
    persistBoard({ ...boardPrefs, lanes: { ...(boardPrefs.lanes ?? {}), [state]: serializeLane(nextLane) } });
  };

  // Resolve the render order: saved order first (validated), any lane missing
  // from it appended in the canonical SHELF_ORDER so a partial list is safe.
  const effectiveOrder = useMemo(() => {
    const seen = new Set<FulfillmentState>();
    const result: FulfillmentState[] = [];
    for (const s of order) {
      if (SHELF_ORDER.includes(s) && !seen.has(s)) {
        seen.add(s);
        result.push(s);
      }
    }
    for (const s of SHELF_ORDER) if (!seen.has(s)) result.push(s);
    return result;
  }, [order]);

  // Drag-end → reorder the lanes and persist the new order per staffer.
  const reorderLanes = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = effectiveOrder.indexOf(active.id as FulfillmentState);
    const newIdx = effectiveOrder.indexOf(over.id as FulfillmentState);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(effectiveOrder, oldIdx, newIdx);
    setOrder(next);
    persistBoard({ ...boardPrefs, order: next });
  };

  const lanes = useMemo(() => {
    const buckets: Record<FulfillmentState, ShippedOrder[]> = { PENDING: [], TESTED: [], BLOCKED: [] };
    for (const r of records as FulfillmentRow[]) buckets[rowState(r)].push(r);
    // Each lane filters its own bucket by its own header date picker.
    const out = {} as Record<FulfillmentState, ShippedOrder[]>;
    for (const s of SHELF_ORDER) {
      const rng = laneMap[s].range;
      out[s] = rng?.from ? buckets[s].filter((r) => inDateRange(r, rng)) : buckets[s];
    }
    return out;
  }, [records, laneMap]);

  const visibleTotal = lanes.PENDING.length + lanes.TESTED.length + lanes.BLOCKED.length;
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
        <h2 className="text-caption font-black uppercase tracking-widest text-gray-700">Unshipped</h2>
        <span className="text-eyebrow font-bold uppercase tracking-widest text-gray-400">
          {visibleTotal} orders
        </span>
        <div className="ml-auto flex items-center gap-2">
          <BoardStaffFilter />
          <HorizontalButtonSlider
            items={COLUMN_ITEMS}
            value={String(columns)}
            onChange={(id) => changeColumns(Number(id) as ColumnCount)}
            variant="nav"
            navIconOnly
            dense
            aria-label="Board columns"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorderLanes}>
          <SortableContext items={effectiveOrder} strategy={isGrid ? rectSortingStrategy : verticalListSortingStrategy}>
            <div className={gridClass}>
              {effectiveOrder.map((state) => (
                <ShelfBubble
                  key={state}
                  state={state}
                  rows={lanes[state]}
                  loading={loading}
                  searchValue={searchValue}
                  colCount={columns}
                  sort={laneMap[state].sort}
                  expanded={laneMap[state].expanded}
                  height={laneMap[state].height}
                  range={laneMap[state].range}
                  onSortChange={(s) => mutateLane(state, { sort: s })}
                  onRangeChange={(r) => mutateLane(state, { range: r })}
                  // Snapping to a preset clears any drag-resized height.
                  onToggleExpanded={() => mutateLane(state, { expanded: !laneMap[state].expanded, height: null })}
                  onResize={(px) => mutateLane(state, { height: px })}
                  onOpenRecord={onOpenRecord}
                  onClearSearch={onClearSearch}
                  searchEmptyTitle={searchEmptyTitle}
                  searchResultLabel={searchResultLabel}
                  clearSearchLabel={clearSearchLabel}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
