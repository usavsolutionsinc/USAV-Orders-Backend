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
 * The board's own top toolbar (the header band) hosts Unshipped-specific controls:
 * {@link BoardStaffFilter} on the left (contextual scope), and on the right the
 * shared {@link ColumnConfigButton} plus (when the page arms it) {@link
 * BoardSelectToggle} beside the column-layout toggles.
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
import { BoardSelectToggle } from '@/components/board/BoardSelectToggle';
import { ToolbarButton } from '@/components/ui/ToolbarButton';
import {
  deriveFulfillmentState,
  FULFILLMENT_STATE_META,
  type FulfillmentState,
} from '@/lib/unshipped-state';
import { FULFILLMENT_BOARD_LANES, type FulfillmentLaneIconKey } from '@/lib/order-lifecycle';
import type { ShippedOrder } from '@/types/orders';

/**
 * Phase-0 virtualization canary (kill-switch). The lane bodies window their rows
 * via `@tanstack/react-virtual` (mirroring the Shipped board, which virtualizes
 * unconditionally), so a lane's DOM stays ∝ viewport regardless of queue depth.
 * ON by default; set `NEXT_PUBLIC_UNSHIPPED_VIRTUAL_LIST=0` to fall back to the
 * all-rows-mounted body. Remove the gate after bake-in.
 */
const VIRTUAL_LANES = process.env.NEXT_PUBLIC_UNSHIPPED_VIRTUAL_LIST !== '0';

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
          isActive ? 'bg-blue-50 text-blue-700' : 'text-text-muted hover:bg-surface-hover'
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
        <ToolbarButton active={active} aria-label={`Filter by staff: ${label}`} className="max-w-[160px]">
          <User className="h-3.5 w-3.5 shrink-0 opacity-70" />
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </ToolbarButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-dropdown max-h-[60vh] w-52 overflow-y-auto rounded-lg border border-border-soft bg-surface-card p-1 shadow-lg ring-1 ring-black/5 focus:outline-none"
        >
          <Row id={null} name="All staff" />
          {options.length > 0 ? <div className="my-1 h-px bg-surface-sunken" /> : null}
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
  /** Flip select-mode. When set, the board toolbar shows a Select toggle. */
  onToggleSelectMode?: () => void;
  /** Optional "Load more" footer (Phase 2), rendered below the grid. */
  footer?: React.ReactNode;
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
  onToggleSelectMode,
  footer,
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
        virtualized={VIRTUAL_LANES}
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

  // Contextual staff scope sits on the LEFT — it narrows the whole board before
  // layout/view controls. Column config + select stay on the right with the column
  // toggles. Staff filter is board-wide (`?staff=`), so one instance filters every lane.
  const headerStartSlot = useMemo(() => <BoardStaffFilter />, []);

  const headerEndSlot = useMemo(
    () => (
      <div className="flex items-center gap-2">
        <ColumnConfigButton variant="toolbar" />
        {onToggleSelectMode ? (
          <BoardSelectToggle active={selectMode} onToggle={onToggleSelectMode} />
        ) : null}
      </div>
    ),
    [selectMode, onToggleSelectMode],
  );

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
        headerStartSlot={headerStartSlot}
        headerEndSlot={headerEndSlot}
        getRowDate={getRowDate}
        renderLaneBody={renderLaneBody}
        footerSlot={footer}
      />
    </TableColumnConfigProvider>
  );
}
