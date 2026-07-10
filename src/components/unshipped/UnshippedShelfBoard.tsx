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
 * Archetype (intentional hybrid — don't "normalize" away): a pipeline-workbench.
 * The lanes are a Monitor-style read of *derived* state, but the surface obeys
 * Workbench rules — URL-addressable selection (`?openOrderId`) and a crossfading
 * right-pane detail. It is NOT a recent-activity rail: do not refactor it onto
 * `SidebarRailShell` (that shell is a single vertical-list engine; this is a
 * horizontal multi-lane board with its own virtualization). See
 * `.claude/rules/display/workbench.md`.
 *
 * Add a fulfillment lane → extend FULFILLMENT_BOARD_LANES (order-lifecycle.ts)
 * + FULFILLMENT_STATE_META; the bubble appears with no change here.
 */

import { useCallback, useMemo, type RefObject } from 'react';
import { AlertTriangle, Check, Clock } from '@/components/Icons';
import {
  SwimlaneBoard,
  type SwimlaneLaneDef,
  type SwimlaneSortOption,
} from '@/components/board/SwimlaneBoard';
import { OrdersQueueTable } from '@/components/dashboard/OrdersQueueTable';
import { ORDERS_QUEUE_SORTS, ORDERS_QUEUE_SORT_LABEL, type OrdersQueueSort } from '@/components/dashboard/orders-queue/helpers';
import { DASHBOARD_ORDERS_SELECTION_SCOPE } from '@/lib/selection/dashboard-scopes';
import { StaffFilterButton } from '@/components/ui/StaffFilterButton';
import { TableColumnConfigProvider } from '@/components/ui/table-column-config/TableColumnConfig';
import { ColumnConfigButton } from '@/components/ui/table-column-config/ColumnConfigButton';
import { BoardSelectToggle } from '@/components/board/BoardSelectToggle';
import { TableOptionsMenu } from '@/components/ui/table-options/TableOptionsMenu';
import {
  deriveFulfillmentState,
  FULFILLMENT_STATE_META,
  type FulfillmentState,
} from '@/lib/unshipped-state';
import { FULFILLMENT_BOARD_LANES, type FulfillmentLaneIconKey } from '@/lib/order-lifecycle';
import type { ShippedOrder } from '@/types/orders';

/**
 * Phase-0 virtualization canary — now OFF by default. The windowed lane bodies
 * (`@tanstack/react-virtual`) mis-measure on first mount, so a freshly-loaded
 * board renders BLANK lanes (rows only appear after a column toggle / resize
 * forces a re-measure). The unshipped queue is bounded (rowLimit 200, split
 * across the 3 lanes), so mounting all rows is cheap and always paints — the
 * board's shared scroll region owns the wheel. Opt back in with
 * `NEXT_PUBLIC_UNSHIPPED_VIRTUAL_LIST=1` once the first-mount measurement race
 * is fixed.
 */
const VIRTUAL_LANES = process.env.NEXT_PUBLIC_UNSHIPPED_VIRTUAL_LIST === '1';

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

/** Params that define an Unshipped saved view (filters only — never search text). */
const UNSHIPPED_VIEW_PARAMS = ['stage', 'ustatus', 'staff'] as const;

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
 * Board-level staff filter — the shared {@link StaffFilterButton} pill that
 * writes the canonical `?staff=` param. The unshipped query already narrows its
 * rows to that staff, so picking one filters every lane at once; "All staff"
 * clears it. (Was a local popover; promoted to the shared control — P1-WORK-02.)
 */
function BoardStaffFilter() {
  return <StaffFilterButton align="start" />;
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
      scrollParentRef,
    }: {
      laneLabel: string;
      rows: ShippedOrder[];
      sort: OrdersQueueSort;
      maxBodyHeightClass?: string;
      maxBodyHeightPx?: number;
      growToContent?: boolean;
      scrollParentRef?: RefObject<HTMLElement | null>;
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
        scrollParentRef={scrollParentRef}
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
        <TableOptionsMenu
          showDensity={false}
          savedViews={{ storageKey: 'unshipped_saved_views', paramKeys: UNSHIPPED_VIEW_PARAMS }}
        />
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
