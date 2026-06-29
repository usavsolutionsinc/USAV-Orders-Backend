'use client';

/**
 * Unshipped · Shelf Board — the fulfillment-queue instance of the reusable
 * {@link SwimlaneBoard}. This file is now a thin consumer: it supplies only the
 * Unshipped-specific bits — the PENDING / TESTED / BLOCKED lane model (derived
 * from FULFILLMENT_STATE_META, never assigned), the per-row lane bucket
 * (`deriveFulfillmentState`), the queue sort vocabulary, the date field the
 * per-lane picker filters on, and the lane body (the SAME `OrdersQueueTable`
 * rows the dense table uses, header suppressed, vertical-only). Everything
 * structural (bubbles, drag-reorder, drag-resize, 1/2-up toggle, 40px header
 * band, per-staff persistence under `unshippedBoard`) lives in `SwimlaneBoard`.
 *
 * Two header controls are Unshipped-specific and ride in the board's header
 * slots: the shared {@link ColumnConfigButton} (start) and {@link BoardStaffFilter}
 * (each lane header, beside sort + date). Column visibility is owned here via {@link TableColumnConfigProvider}
 * `tableId="orders"`, wrapping the board so every lane's mini table honors the
 * same hidden-key set as the dense table; the board's `inheritColumnConfig`
 * embed keeps them in sync.
 *
 * Add a fulfillment lane → extend FULFILLMENT_BOARD_LANES (order-lifecycle.ts)
 * + FULFILLMENT_STATE_META; the bubble appears with no change here.
 */

import { useCallback, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { AlertTriangle, Check, ChevronDown, Clock, User } from '@/components/Icons';
import {
  SwimlaneBoard,
  type SwimlaneLaneDef,
  type SwimlaneSortOption,
} from '@/components/board/SwimlaneBoard';
import { OrdersQueueTable } from '@/components/dashboard/OrdersQueueTable';
import { ORDERS_QUEUE_SORTS, ORDERS_QUEUE_SORT_LABEL, type OrdersQueueSort } from '@/components/dashboard/orders-queue/helpers';
import { DASHBOARD_ORDERS_SELECTION_SCOPE } from '@/lib/selection/dashboard-scopes';
import { useStaffFilter } from '@/hooks/useStaffFilter';
import { TableColumnConfigProvider } from '@/components/ui/table-column-config/TableColumnConfig';
import { ColumnConfigButton } from '@/components/ui/table-column-config/ColumnConfigButton';
import {
  deriveFulfillmentState,
  FULFILLMENT_STATE_META,
  type FulfillmentState,
} from '@/lib/unshipped-state';
import { FULFILLMENT_BOARD_LANES, type FulfillmentLaneIconKey } from '@/lib/order-lifecycle';
import type { ShippedOrder } from '@/types/orders';

/** Icon binding — maps the lib's lane icon key to a concrete glyph (React stays here). */
const LANE_ICON: Record<FulfillmentLaneIconKey, React.ComponentType<{ className?: string }>> = {
  clock: Clock,
  check: Check,
  alert: AlertTriangle,
};

/**
 * Lane model handed to the board. Lane ORDER + icon binding come from the
 * canonical `FULFILLMENT_BOARD_LANES` descriptor (`order-lifecycle.ts`); the
 * label/dot/description come from the `FULFILLMENT_STATE_META` color SoT. Add a
 * lane in the descriptor, not here — the bubble then appears with no change.
 */
const UNSHIPPED_LANES: SwimlaneLaneDef<FulfillmentState>[] = FULFILLMENT_BOARD_LANES.map((lane) => ({
  id: lane.id,
  label: FULFILLMENT_STATE_META[lane.id].label,
  dot: FULFILLMENT_STATE_META[lane.id].dot,
  description: FULFILLMENT_STATE_META[lane.id].description,
  icon: LANE_ICON[lane.iconKey],
  iconClass: lane.iconClass,
}));

/** Queue sort vocabulary, shared with the dense table. */
const UNSHIPPED_SORT_OPTIONS: SwimlaneSortOption<OrdersQueueSort>[] = ORDERS_QUEUE_SORTS.map((s) => ({
  id: s,
  label: ORDERS_QUEUE_SORT_LABEL[s],
}));

/** Runtime-only fields the queue rows carry but ShippedOrder doesn't type. */
type FulfillmentRow = ShippedOrder & {
  has_tech_scan?: boolean | null;
  out_of_stock?: string | null;
};

/** A card's lane is COMPUTED, never assigned. */
function rowState(row: ShippedOrder): FulfillmentState {
  const r = row as FulfillmentRow;
  return deriveFulfillmentState({
    hasTechScan: Boolean(r.has_tech_scan),
    outOfStock: r.out_of_stock,
  });
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
        className={`ds-raw-button flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-caption font-semibold transition-colors ${
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
          className={`ds-raw-button inline-flex h-7 max-w-[160px] shrink-0 items-center gap-1.5 rounded-md border px-2 text-eyebrow font-bold uppercase tracking-widest transition-colors ${
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

export interface UnshippedShelfBoardProps {
  records: ShippedOrder[];
  loading: boolean;
  searchValue: string;
  onOpenRecord: (record: ShippedOrder) => void;
  onClearSearch: () => void;
  searchEmptyTitle?: string;
  searchResultLabel?: string;
  clearSearchLabel?: string;
  /** Pencil multi-select: lane rows render checkboxes; the page owns the bar. */
  selectMode?: boolean;
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
  selectMode = false,
}: UnshippedShelfBoardProps) {
  // Each lane body is the real queue table — header suppressed, vertical-only,
  // sized to content up to the lane's cap (preset class or drag-resized px).
  const renderLaneBody = useCallback(
    ({
      laneLabel,
      rows,
      sort,
      maxBodyHeightClass,
      maxBodyHeightPx,
      growToContent,
    }: {
      laneLabel: string;
      rows: ShippedOrder[];
      sort: OrdersQueueSort;
      maxBodyHeightClass?: string;
      maxBodyHeightPx?: number;
      growToContent?: boolean;
    }) => (
      <OrdersQueueTable
        hideHeader
        inheritColumnConfig
        noHorizontalScroll
        autoHeight
        maxBodyHeightClass={maxBodyHeightClass}
        maxBodyHeightPx={maxBodyHeightPx}
        growToContent={growToContent}
        records={rows}
        queueMode="fulfillment"
        sort={sort}
        selectMode={selectMode}
        selectionScope={DASHBOARD_ORDERS_SELECTION_SCOPE}
        loading={loading}
        isRefreshing={false}
        searchValue={searchValue}
        onClearSearch={onClearSearch}
        emptyMessage={`No ${laneLabel.toLowerCase()} orders`}
        searchEmptyTitle={searchEmptyTitle}
        searchResultLabel={searchResultLabel}
        clearSearchLabel={clearSearchLabel}
        onOpenRecord={onOpenRecord}
      />
    ),
    [loading, searchValue, onClearSearch, searchEmptyTitle, searchResultLabel, clearSearchLabel, onOpenRecord, selectMode],
  );

  // Filter the per-lane date picker on the order's created/deadline date.
  const getRowDate = useCallback((r: ShippedOrder) => r.created_at || r.deadline_at, []);

  // Icon-only column config, pinned top-right of the header band (matches the
  // Shipped board). No left-side label/title text.
  const headerEndSlot = useMemo(() => <ColumnConfigButton iconOnly />, []);
  const laneHeaderSlot = useMemo(() => <BoardStaffFilter />, []);

  return (
    <TableColumnConfigProvider tableId="orders">
      <SwimlaneBoard<ShippedOrder, FulfillmentState, OrdersQueueSort>
        prefsKey="unshippedBoard"
        lanes={UNSHIPPED_LANES}
        bucket={rowState}
        records={records}
        maxColumns={2}
        sortOptions={UNSHIPPED_SORT_OPTIONS}
        defaultSort="priority"
        headerEndSlot={headerEndSlot}
        laneHeaderSlot={laneHeaderSlot}
        getRowDate={getRowDate}
        renderLaneBody={renderLaneBody}
      />
    </TableColumnConfigProvider>
  );
}
