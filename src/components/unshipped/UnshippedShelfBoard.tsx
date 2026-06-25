'use client';

/**
 * Unshipped · Shelf Board — the bubble-list pipeline view of the fulfillment
 * queue. Each fulfillment state is a rounded "bubble" card; inside it are the
 * real `OrdersQueueTable` rows (same exact component the dense table uses),
 * scrolled VERTICALLY only — no horizontal scroll, no bottom scrollbar.
 *
 * The board's controls (title + total, the real DateRangePickerField, and the
 * 1-up/2-up layout toggle) live in a dedicated 40px in-panel header that matches
 * the sidebar master-nav modes band — sitting ABOVE the scroll region so each
 * bubble's sticky chip date header still docks correctly. Each bubble has a
 * compact header (drag handle + state icon + label + count; sort top-right), a
 * body that sizes to content up to a cap (`autoHeight` → no trailing
 * whitespace), a footer that snaps to the expanded/collapsed preset, and a
 * bottom drag handle to resize the body. 2-up lays bubbles side by side.
 *
 * Lanes can be drag-reordered (whole bubble, via @dnd-kit) and drag-resized from
 * the bottom edge; layout, date range, lane order, and per-lane sort/expand/height
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
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, ArrowUpDown, Check, ChevronDown, ChevronUp, Clock, GripVertical } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { DateRangePickerField } from '@/design-system/components/DateRangePickerField';
import { OrdersQueueTable } from '@/components/dashboard/OrdersQueueTable';
import { ORDERS_QUEUE_SORTS, ORDERS_QUEUE_SORT_LABEL, type OrdersQueueSort } from '@/components/dashboard/orders-queue/helpers';
import { DASHBOARD_ORDERS_SELECTION_SCOPE } from '@/lib/selection/dashboard-scopes';
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

/** Board layout — bubbles stacked 1-up or laid 2-up side by side. */
const COLUMN_ITEMS: HorizontalSliderItem[] = [
  { id: '1', label: '1 Col' },
  { id: '2', label: '2 Col' },
];

/** Per-card sort cycle — the full shared `OrdersQueueSort` set + labels. */
const SORT_CYCLE = ORDERS_QUEUE_SORTS;
const SORT_LABEL = ORDERS_QUEUE_SORT_LABEL;

type BoardPrefs = NonNullable<StaffPreferences['unshippedBoard']>;
/** `height` is a drag-resized body cap (px); `null` → snap to expanded/collapsed preset. */
type LaneState = { sort: OrdersQueueSort; expanded: boolean; height: number | null };
type LaneMap = Record<FulfillmentState, LaneState>;

const DEFAULT_LANE: LaneState = { sort: 'priority', expanded: true, height: null };
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

function cycle<T>(arr: T[], current: T): T {
  const i = arr.indexOf(current);
  return arr[(i + 1) % arr.length];
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
  twoUp: boolean;
  sort: OrdersQueueSort;
  expanded: boolean;
  /** Drag-resized body cap (px); null → snap to the expanded/collapsed preset. */
  height: number | null;
  onSortCycle: () => void;
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
  twoUp,
  sort,
  expanded,
  height,
  onSortCycle,
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
  // 2-up cards are narrower, so their default max height is shorter (tidy row).
  const presetMaxClass = expanded ? (twoUp ? 'max-h-[56vh]' : 'max-h-[70vh]') : 'max-h-72';

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
      {/* Compact header — drag handle + state dot + icon + label + count (left); sort (right). */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-2.5 py-1.5">
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
        <h3 className="text-eyebrow font-black uppercase tracking-widest text-gray-500">{meta.label}</h3>
        <span className="text-eyebrow font-black uppercase tracking-widest text-gray-400">{rows.length}</span>
        <div className="ml-auto">
          <HoverTooltip label="Sort order" focusable={false}>
            <button
              type="button"
              onClick={onSortCycle}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-widest text-gray-600 transition hover:bg-gray-50"
            >
              <ArrowUpDown className="h-3 w-3" />
              {SORT_LABEL[sort]}
            </button>
          </HoverTooltip>
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

  const [columns, setColumns] = useState<1 | 2>(1);
  const [range, setRange] = useState<DateRange | undefined>(undefined);
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
    if (b.columns === 1 || b.columns === 2) setColumns(b.columns);
    if (Array.isArray(b.order) && b.order.length > 0) {
      const valid = b.order.filter((s): s is FulfillmentState => SHELF_ORDER.includes(s));
      if (valid.length > 0) setOrder(valid);
    }
    if (b.range?.from) {
      setRange({ from: new Date(b.range.from), to: b.range.to ? new Date(b.range.to) : undefined });
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
            };
          }
        }
        return next;
      });
    }
  }, [prefs]);

  const changeColumns = (next: 1 | 2) => {
    setColumns(next);
    persistBoard({ ...boardPrefs, columns: next });
  };

  const changeRange = (next: DateRange | undefined) => {
    setRange(next);
    persistBoard({
      ...boardPrefs,
      range: next?.from
        ? { from: next.from.toISOString(), to: (next.to ?? next.from).toISOString() }
        : null,
    });
  };

  const mutateLane = (state: FulfillmentState, patch: Partial<LaneState>) => {
    const nextLane = { ...laneMap[state], ...patch };
    setLaneMap((cur) => ({ ...cur, [state]: nextLane }));
    persistBoard({ ...boardPrefs, lanes: { ...(boardPrefs.lanes ?? {}), [state]: nextLane } });
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
    for (const r of records as FulfillmentRow[]) {
      if (!inDateRange(r, range)) continue;
      buckets[rowState(r)].push(r);
    }
    return buckets;
  }, [records, range]);

  const visibleTotal = lanes.PENDING.length + lanes.TESTED.length + lanes.BLOCKED.length;
  const twoUp = columns === 2;

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
          <DateRangePickerField
            value={range}
            onChange={changeRange}
            placeholder="All dates"
            className="w-auto min-w-[150px]"
          />
          <HorizontalButtonSlider
            items={COLUMN_ITEMS}
            value={String(columns)}
            onChange={(id) => changeColumns(Number(id) as 1 | 2)}
            variant="nav"
            dense
            aria-label="Board columns"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorderLanes}>
          <SortableContext items={effectiveOrder} strategy={twoUp ? rectSortingStrategy : verticalListSortingStrategy}>
            <div className={twoUp ? 'grid grid-cols-2 items-start gap-4' : 'space-y-4'}>
              {effectiveOrder.map((state) => (
                <ShelfBubble
                  key={state}
                  state={state}
                  rows={lanes[state]}
                  loading={loading}
                  searchValue={searchValue}
                  twoUp={twoUp}
                  sort={laneMap[state].sort}
                  expanded={laneMap[state].expanded}
                  height={laneMap[state].height}
                  onSortCycle={() => mutateLane(state, { sort: cycle(SORT_CYCLE, laneMap[state].sort) })}
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
