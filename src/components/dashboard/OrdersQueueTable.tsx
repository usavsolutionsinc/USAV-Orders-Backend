'use client';

import { useCallback, useEffect, useRef, useState, memo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { sectionLabel, fieldLabel, SkeletonList } from '@/design-system';
import { Check, Loader2 } from '@/components/Icons';
import { mainStickyHeaderClass, mainStickyHeaderRowClass, mainStickyHeaderCompactRowClass } from '@/components/layout/header-shell';
import { OrderIdentityChips } from '@/components/ui/OrderIdentityChips';
import {
  OrderIdChip,
  PlatformChip,
  TrackingOrSkuScanChip,
  TrackingCountChip,
  getLast4,
} from '@/components/ui/CopyChip';
import { ChipColumns, CHIP_COL, type ChipColumn } from '@/components/ui/ChipColumns';
import { CollapsibleGroupRow } from '@/components/ui/CollapsibleGroupRow';
import { groupRowsBy, type RowGroup } from '@/lib/group-rows';
import { RowTitle, RowMetaColumns, META_COL } from '@/components/ui/RowMetaColumns';
import { useTableSelectMode } from '@/hooks/useTableSelectMode';
import { getOrderPlatformLabel, getOrderPlatformColor, getOrderPlatformBorderColor, isFbaOrder } from '@/utils/order-platform';
import { getExternalUrlByItemNumber, skuScanPrefixBeforeColon } from '@/hooks/useExternalItemUrl';
import WeekHeader from '@/components/ui/WeekHeader';
import { toPSTDateKey, getDaysLateNullable, getDaysLateTone } from '@/utils/date';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { useStaffNameMap } from '@/hooks/useStaffNameMap';
import { DateGroupHeader } from '@/components/ui/DateGroupHeader';
import { OrderSearchEmptyState } from '@/components/dashboard/OrderSearchEmptyState';
import { getOpenShippedDetailsPayload } from '@/utils/events';
import { isSkuSourceRecord } from '@/utils/source-dot';
import { deriveFulfillmentState, FULFILLMENT_STATE_META } from '@/lib/unshipped-state';
import { OUTBOUND_STATE_META } from '@/lib/outbound-state';
import { UNSHIPPED_STATE_META } from '@/lib/unshipped-state';
import { AddTrackingPopover } from '@/components/outbound/labels/AddTrackingPopover';
import { useUIModeOptional } from '@/design-system/providers/UIModeProvider';
import {
  dashboardOrderRowShellClass,
  dashboardOrderRowChipsClass,
} from '@/lib/dashboard-order-row-layout';

/**
 * Format an order line's realized sale price (orders.sale_amount + currency)
 * for the row meta. Returns null when there's no amount so the slot stays
 * empty — most legacy orders have no price yet; only newly-ingested ones do.
 */
function formatSalePrice(
  amount: string | number | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (amount == null || amount === '') return null;
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) return null;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (currency || 'USD').toUpperCase(),
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function normalizePersonName(value: unknown): string {
  const text = String(value ?? '')
    .replace(/^tech:\s*/i, '')
    .replace(/^packer:\s*/i, '')
    .trim();
  if (!text || /^(not specified|n\/a|null|undefined|staff\s*#\d+)$/i.test(text)) return '---';
  return text;
}

interface WeekRange {
  startStr: string;
  endStr: string;
}

type QueueRowRecord = ShippedOrder & Record<string, unknown>;

/** Which surface owns this table — drives status dots and tracking affordances. */
export type OrdersQueueMode = 'fulfillment' | 'labels' | 'staged';

interface RowStatusMeta {
  dot: string;
  label: string;
  description: string;
}

function resolveRowStatus(record: QueueRowRecord, queueMode: OrdersQueueMode): RowStatusMeta {
  if (queueMode === 'labels') {
    const meta = UNSHIPPED_STATE_META.AWAITING_LABEL;
    return { dot: meta.dot, label: meta.label, description: meta.description };
  }
  if (queueMode === 'staged') {
    const meta = OUTBOUND_STATE_META.PACKED_STAGED;
    return { dot: meta.dot, label: meta.label, description: meta.description };
  }
  const state = deriveFulfillmentState({
    shipmentId: record.shipment_id,
    hasTechScan: Boolean(record.has_tech_scan),
    outOfStock: record.out_of_stock as string | null | undefined,
  });
  const meta = FULFILLMENT_STATE_META[state];
  return { dot: meta.dot, label: meta.label, description: meta.description };
}

/** Memoized row: when React Query merges one updated order, unrelated rows skip re-render. */
const OrdersQueueTableRow = memo(function OrdersQueueTableRow({
  record,
  isSelected,
  selectMode,
  isChecked,
  useAlternateStripe,
  testerDisplay,
  packerDisplay,
  testerId,
  packerId,
  rowStatus,
  trackingAction,
  hasOutOfStock,
  outOfStockValue,
  daysLate,
  isMobile,
  onRowClick,
}: {
  record: QueueRowRecord;
  isSelected: boolean;
  /** Pencil multi-select on — render a leading checkbox; click toggles. */
  selectMode: boolean;
  /** Whether this row is checked (only meaningful when `selectMode`). */
  isChecked: boolean;
  isMobile: boolean;
  useAlternateStripe: boolean;
  testerDisplay: string;
  packerDisplay: string;
  testerId: number | null;
  packerId: number | null;
  rowStatus: RowStatusMeta;
  /** Optional trailing chip action (Outbound · Labels add-tracking popover). */
  trackingAction?: React.ReactNode;
  hasOutOfStock: boolean;
  outOfStockValue: string;
  daysLate: number | null;
  /** `event` carries `shiftKey` for range-select; structural so both mouse +
   *  keyboard events satisfy it. */
  onRowClick: (record: ShippedOrder, event?: { shiftKey: boolean }) => void;
}) {
  const qty = parseInt(String(record.quantity || '1'), 10) || 1;
  const trackingRaw =
    (record.tracking_number as string | undefined) ||
    record.shipping_tracking_number ||
    '';
  const scanRefFromRecord = (record as QueueRowRecord & { scan_ref?: unknown }).scan_ref;
  const scanRefForSku =
    (typeof scanRefFromRecord === 'string' && scanRefFromRecord ? scanRefFromRecord : null) ?? trackingRaw;
  const hideOrderIdChip = isSkuSourceRecord({
    orderId: record.order_id,
    accountSource: record.account_source,
    trackingType: record.tracking_type,
    scanRef: scanRefForSku,
  });
  const platformLabel = getOrderPlatformLabel(record.order_id || '', record.account_source);
  const isFba = isFbaOrder(record.order_id, record.account_source);
  const platformColor = platformLabel ? getOrderPlatformColor(platformLabel) : '';
  const productPageUrl = getExternalUrlByItemNumber(
    String(record.item_number || '').trim() || skuScanPrefixBeforeColon(trackingRaw),
  );
  const salePrice = formatSalePrice(record.sale_amount, record.currency);

  return (
    <motion.div
      {...framerPresence.tableRow}
      transition={framerTransition.tableRowMount}
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.998 }}
      onClick={(event) => onRowClick(record, event)}
      // Shift-click in select mode otherwise starts a native text selection
      // across the range — suppress it so range-select reads cleanly.
      onMouseDown={(event) => { if (selectMode && event.shiftKey) event.preventDefault(); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onRowClick(record, event);
        }
      }}
      role={selectMode ? 'checkbox' : 'button'}
      tabIndex={0}
      aria-checked={selectMode ? isChecked : undefined}
      aria-pressed={selectMode ? undefined : isSelected}
      aria-label={selectMode ? `Select order ${record.order_id || record.id}` : `Open order ${record.order_id || record.id}`}
      data-order-row-id={String(record.id)}
      className={`${dashboardOrderRowShellClass(isMobile)} border-b border-gray-100 px-3 py-1.5 transition-all cursor-pointer hover:bg-blue-50/50 ${
        isSelected ? 'bg-blue-50/80' : useAlternateStripe ? 'bg-white' : 'bg-gray-50/40'
      }`}
    >
      <div className="flex flex-col min-w-0">
        <RowTitle
          leading={
            selectMode ? (
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                  isChecked ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white'
                }`}
              >
                {isChecked && <Check className="h-3 w-3" />}
              </span>
            ) : undefined
          }
          dot={rowStatus.dot}
          dotTitle={`${rowStatus.label} — ${rowStatus.description}`}
          title={record.product_title || 'Unknown Product'}
        />
        <RowMetaColumns
          // Select mode adds a leading checkbox (w-4 + mr-2 = 1.5rem); shift the
          // meta indent by that same offset so qty stays under the title.
          indent={selectMode ? `calc(${META_COL.indent} + 1.5rem)` : undefined}
          qty={<span className={qty > 1 ? 'text-yellow-600' : 'text-gray-500'}>{qty}</span>}
          condition={
            <span className={String(record.condition || '').trim().toLowerCase() === 'new' ? 'text-yellow-600' : 'text-gray-400'}>
              {record.condition || 'N/A'}
            </span>
          }
          rest={
            <>
              {salePrice ? (
                <span className="normal-case tracking-normal text-emerald-600">{salePrice}</span>
              ) : null}
              {daysLate !== null ? (
                <span className={getDaysLateTone(daysLate)}>{daysLate}</span>
              ) : null}
              {hasOutOfStock ? (
                <span className="text-red-600">{outOfStockValue}</span>
              ) : null}
            </>
          }
        />
      </div>

      <OrderIdentityChips
        platformLabel={platformLabel}
        platformIconClass={platformLabel && productPageUrl ? platformColor : 'text-gray-500'}
        platformBorderClass={getOrderPlatformBorderColor(platformLabel)}
        productPageUrl={productPageUrl}
        isFba={isFba}
        orderId={record.order_id || ''}
        hideOrderId={hideOrderIdChip}
        tracking={trackingRaw}
        trackingAction={trackingAction}
        isMobile={isMobile}
      />
    </motion.div>
  );
}, (prev, next) => {
  if (prev.isMobile !== next.isMobile) return false;
  if (prev.record.id !== next.record.id) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.selectMode !== next.selectMode) return false;
  if (prev.isChecked !== next.isChecked) return false;
  if (prev.useAlternateStripe !== next.useAlternateStripe) return false;
  if (prev.testerDisplay !== next.testerDisplay) return false;
  if (prev.packerDisplay !== next.packerDisplay) return false;
  if (prev.testerId !== next.testerId) return false;
  if (prev.packerId !== next.packerId) return false;
  if (prev.rowStatus.dot !== next.rowStatus.dot) return false;
  if (prev.rowStatus.label !== next.rowStatus.label) return false;
  if (prev.hasOutOfStock !== next.hasOutOfStock) return false;
  if (prev.outOfStockValue !== next.outOfStockValue) return false;
  if (prev.daysLate !== next.daysLate) return false;
  if (prev.record.product_title !== next.record.product_title) return false;
  if (prev.record.condition !== next.record.condition) return false;
  if (prev.record.order_id !== next.record.order_id) return false;
  if (prev.record.quantity !== next.record.quantity) return false;
  if (prev.record.sale_amount !== next.record.sale_amount) return false;
  if (prev.record.currency !== next.record.currency) return false;
  return true;
});

/**
 * Collapsed-header content for a {@link CollapsibleGroupRow} wrapping several
 * order lines that share ONE order number but are DIFFERENT products (e.g. a
 * marketplace order with two items shipped under the same — or different —
 * tracking). Built from the same RowTitle / RowMetaColumns / chip primitives a
 * single line uses, so the header reads like a real row and aligns with the
 * child rows it reveals.
 *
 * The order number is the shared identity (one real #chip); tracking shows one
 * value when the lines ship together, else a ×N count ({@link TrackingCountChip}).
 */
function OrderGroupSummary({ rows, isMobile }: { rows: ShippedOrder[]; isMobile: boolean }) {
  const first = rows[0];
  const orderId = String(first.order_id || '').trim();
  const platformLabel = getOrderPlatformLabel(orderId, first.account_source);
  const isFba = isFbaOrder(orderId, first.account_source);
  const productPageUrl = getExternalUrlByItemNumber(String(first.item_number || '').trim());
  const platformColor = platformLabel ? getOrderPlatformColor(platformLabel) : '';
  const platformIconClass = platformLabel && productPageUrl ? platformColor : 'text-gray-500';

  const qtySum = rows.reduce((sum, r) => sum + (parseInt(String(r.quantity || '1'), 10) || 1), 0);
  const conditions = new Set(rows.map((r) => String(r.condition || '').trim()).filter(Boolean));
  const conditionText = conditions.size === 1 ? [...conditions][0] : conditions.size > 1 ? 'MIXED' : 'N/A';

  // Combined sale price across the lines that share this order number.
  const priceSum = rows.reduce((sum, r) => {
    const n = r.sale_amount == null || r.sale_amount === '' ? NaN : Number(r.sale_amount);
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);
  const groupPrice = priceSum > 0 ? formatSalePrice(priceSum, rows.find((r) => r.currency)?.currency) : null;

  const trackings = new Set(
    rows
      .map((r) => String(((r as QueueRowRecord).tracking_number as string | undefined) || r.shipping_tracking_number || '').trim())
      .filter(Boolean),
  );
  const trackingValue = trackings.size === 1 ? [...trackings][0] : '';

  const platformNode = !isFba ? (
    <PlatformChip
      label={platformLabel}
      underlineClass={getOrderPlatformBorderColor(platformLabel)}
      iconClass={platformIconClass}
      onClick={() => {
        if (productPageUrl) window.open(productPageUrl, '_blank', 'noopener,noreferrer');
      }}
    />
  ) : null;
  const trackingNode = trackingValue
    ? <TrackingOrSkuScanChip value={trackingValue} />
    : trackings.size > 1
      ? <TrackingCountChip count={trackings.size} />
      : null;

  // The row's platform / order-id / tracking columns line up column-for-column
  // with the child rows beneath.
  const columns: ChipColumn[] = [
    { key: 'platform', width: CHIP_COL.platform, node: platformNode },
    { key: 'orderid', width: CHIP_COL.id, node: <OrderIdChip value={orderId} display={getLast4(orderId)} /> },
    { key: 'tracking', width: CHIP_COL.tracking, node: trackingNode },
  ];

  return (
    <div className={dashboardOrderRowShellClass(isMobile)}>
      <div className="flex min-w-0 flex-col">
        <RowTitle
          // Structural group marker (N products share one order#), not a status —
          // neutral gray so it never collides with a pipeline-state dot hue.
          dot="bg-gray-300"
          dotTitle={`${rows.length} products`}
          title={platformLabel ? `${platformLabel} · Order ${orderId}` : `Order ${orderId}`}
        />
        <RowMetaColumns
          qty={<span className={qtySum > 1 ? 'text-yellow-600' : 'text-gray-500'}>{qtySum}</span>}
          condition={<span className="text-gray-400">{conditionText}</span>}
          rest={groupPrice ? <span className="normal-case tracking-normal text-emerald-600">{groupPrice}</span> : null}
        />
      </div>
      {isMobile ? (
        <div className={dashboardOrderRowChipsClass(true)}>
          {platformNode}
          <OrderIdChip value={orderId} display={getLast4(orderId)} dense />
          {trackingValue
            ? <TrackingOrSkuScanChip value={trackingValue} />
            : trackings.size > 1
              ? <TrackingCountChip count={trackings.size} dense />
              : null}
        </div>
      ) : (
        <ChipColumns columns={columns} />
      )}
    </div>
  );
}

/** Sort order for the date-banded queue. `priority` (default) keeps the current
 *  behavior (soonest deadline, Awaiting-before-Pending within a day); `newest`
 *  bands by created date, most-recently-added first. */
export type OrdersQueueSort = 'priority' | 'newest';

function QueueTableBanner({
  title,
  subtitle,
  compact = false,
  isRefreshing = false,
}: {
  title: string;
  subtitle?: string;
  compact?: boolean;
  isRefreshing?: boolean;
}) {
  const rowClass = compact ? mainStickyHeaderCompactRowClass : mainStickyHeaderRowClass;

  return (
    <div className={mainStickyHeaderClass}>
      <div className={rowClass}>
        {compact ? (
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            <span className={`${sectionLabel} shrink-0 text-blue-700`}>{title}</span>
            {subtitle ? (
              <span className={`${fieldLabel} truncate text-gray-600`}>{subtitle}</span>
            ) : null}
          </div>
        ) : (
          <div>
            <p className={`${sectionLabel} text-blue-700`}>{title}</p>
            {subtitle ? (
              <p className={`${fieldLabel} mt-0.5 text-gray-500`}>{subtitle}</p>
            ) : null}
          </div>
        )}
        <div className="min-w-[18px] flex items-center justify-end">
          {isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" /> : null}
        </div>
      </div>
    </div>
  );
}

export interface OrdersQueueTableProps {
  records: ShippedOrder[];
  loading: boolean;
  isRefreshing: boolean;
  searchValue: string;
  weekRange?: WeekRange;
  weekOffset?: number;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  onResetWeek?: () => void;
  showWeekControls?: boolean;
  onClearSearch: () => void;
  emptyMessage: string;
  searchEmptyTitle?: string;
  searchResultLabel?: string;
  clearSearchLabel?: string;
  bannerTitle?: string;
  bannerSubtitle?: string;
  /** Single-line 40px banner row (title + subtitle on one line). */
  bannerCompact?: boolean;
  onOpenRecord?: (record: ShippedOrder) => void;
  onCloseRecord?: (record: ShippedOrder | null) => void;
  /** When true, display tester/packer from work_assignments (tester_id, packer_id) only */
  useWaForDisplay?: boolean;
  /** Sort order (default `priority`). Driven by `?sort` on the merged Unshipped mode. */
  sort?: OrdersQueueSort;
  /** Pencil multi-select: rows render checkboxes and click toggles instead of
   *  opening the detail. Off by default so other consumers are unaffected. */
  selectMode?: boolean;
  /** Selection scope shared with the page's useTableSelection + action bar.
   *  Required when `selectMode` is on. */
  selectionScope?: string;
  /** Surface-specific row chrome (fulfillment / labels / staged). */
  queueMode?: OrdersQueueMode;
}

export function OrdersQueueTable({
  records,
  loading,
  isRefreshing,
  searchValue,
  weekRange,
  weekOffset = 0,
  onPrevWeek,
  onNextWeek,
  onResetWeek,
  showWeekControls = false,
  onClearSearch,
  emptyMessage,
  searchEmptyTitle = 'Order not found',
  searchResultLabel = 'records',
  clearSearchLabel = 'Show All Orders',
  bannerTitle,
  bannerSubtitle,
  bannerCompact = false,
  onOpenRecord,
  onCloseRecord,
  useWaForDisplay = false,
  sort = 'priority',
  selectMode = false,
  selectionScope = 'orders-queue',
  queueMode = 'fulfillment',
}: OrdersQueueTableProps) {
  const { isMobile } = useUIModeOptional();
  const { getStaffName } = useStaffNameMap();
  const [selectedRecord, setSelectedRecord] = useState<ShippedOrder | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isShippedByLatestStatus = (record: ShippedOrder): boolean => {
    const category = String(record.latest_status_category ?? '').trim().toUpperCase();
    const label = String(record.latest_status_label ?? '').toUpperCase();
    const description = String(record.latest_status_description ?? '').toUpperCase();
    if (!category) {
      return label.includes('MOVING THROUGH NETWORK') || description.includes('MOVING THROUGH NETWORK');
    }
    return category !== 'LABEL_CREATED' && category !== 'UNKNOWN';
  };
  const visibleRecords = records.filter((record) => !isShippedByLatestStatus(record));

  useEffect(() => {
    if (!selectedRecord) return;
    const nextSelected = visibleRecords.find((record) => Number(record.id) === Number(selectedRecord.id));
    if (nextSelected && nextSelected !== selectedRecord) {
      setSelectedRecord(nextSelected);
      return;
    }
    if (!nextSelected) {
      onCloseRecord?.(selectedRecord);
      setSelectedRecord(null);
    }
  }, [onCloseRecord, selectedRecord, visibleRecords]);

  const handleRowClick = useCallback((record: ShippedOrder) => {
    if (selectedRecord && Number(selectedRecord.id) === Number(record.id)) {
      onCloseRecord?.(selectedRecord);
      setSelectedRecord(null);
      return;
    }
    onOpenRecord?.(record);
    setSelectedRecord(record);
  }, [onCloseRecord, onOpenRecord, selectedRecord]);

  useEffect(() => {
    const handleOpen = (e: CustomEvent<ShippedOrder>) => {
      const payload = getOpenShippedDetailsPayload(e.detail);
      if (payload?.order) setSelectedRecord(payload.order);
    };
    const handleClose = () => setSelectedRecord(null);
    window.addEventListener('open-shipped-details' as any, handleOpen as any);
    window.addEventListener('close-shipped-details' as any, handleClose as any);
    return () => {
      window.removeEventListener('open-shipped-details' as any, handleOpen as any);
      window.removeEventListener('close-shipped-details' as any, handleClose as any);
    };
  }, []);

  const groupedRecords: Record<string, ShippedOrder[]> = {};
  visibleRecords.forEach((record) => {
    // `newest` bands by when the order was added; otherwise by its deadline.
    const dateSource = sort === 'newest'
      ? (record.created_at || record.deadline_at)
      : (record.deadline_at || record.created_at);
    if (!dateSource || dateSource === '1') return;

    let date = '';
    try {
      date = toPSTDateKey(String(dateSource)) || 'Unknown';
    } catch {
      date = 'Unknown';
    }

    if (!groupedRecords[date]) groupedRecords[date] = [];
    groupedRecords[date].push(record);
  });

  // One canonical per-day ordering, shared by the rendered rows AND the flat
  // `displayedRecords` (keyboard nav, awaiting worklist, shift-range select) so
  // the range a shift-click spans matches exactly what's on screen.
  const sortDayRecords = (dayRecords: ShippedOrder[]): ShippedOrder[] =>
    [...dayRecords].sort((a, b) => {
      if (sort === 'newest') {
        const ta = new Date(a.created_at || a.deadline_at || 0).getTime();
        const tb = new Date(b.created_at || b.deadline_at || 0).getTime();
        return tb - ta;
      }
      if (queueMode === 'fulfillment') {
        const testedA = Boolean((a as QueueRowRecord).has_tech_scan) ? 0 : 1;
        const testedB = Boolean((b as QueueRowRecord).has_tech_scan) ? 0 : 1;
        if (testedA !== testedB) return testedA - testedB;
      }
      const timeA = new Date(a.deadline_at || a.created_at || 0).getTime();
      const timeB = new Date(b.deadline_at || b.created_at || 0).getTime();
      return timeA - timeB;
    });

  const sortedGroupedEntries = Object.entries(groupedRecords)
    // `newest` shows the most recent day band first; `priority` shows soonest.
    .sort((a, b) => (sort === 'newest' ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0])))
    .map(([date, dayRecords]) => [date, sortDayRecords(dayRecords)] as [string, ShippedOrder[]]);

  // Within each day, fold the lines that share ONE order number into a single
  // group → a multi-product order renders as one expandable header; the common
  // single-line case stays a plain row. groupRowsBy preserves the per-day sort
  // order, and `displayedRecords` is flattened from the SAME grouped order so
  // keyboard-nav / shift-range select line up with what's actually on screen.
  const orderGroupsByDate: [string, RowGroup<ShippedOrder>[]][] = sortedGroupedEntries.map(
    ([date, dayRecords]) => [
      date,
      groupRowsBy(dayRecords, (r) => String(r.order_id || '').trim() || `id:${r.id}`),
    ],
  );

  const displayedRecords = orderGroupsByDate.flatMap(([, groups]) => groups.flatMap((g) => g.rows));

  // Pencil multi-select wiring (off by default → no-op for non-select callers).
  const getRowId = useCallback((r: ShippedOrder) => Number(r.id), []);
  const { selectedIds, toggle } = useTableSelectMode<ShippedOrder>({
    scope: selectionScope,
    selectMode,
    rows: displayedRecords,
    getId: getRowId,
  });

  // In select mode a click toggles the checkbox instead of opening the detail;
  // shift-click extends the range from the last-clicked anchor.
  const handleRowAction = useCallback(
    (record: ShippedOrder, event?: { shiftKey: boolean }) => {
      if (selectMode) {
        toggle(Number(record.id), event?.shiftKey ?? false);
        return;
      }
      handleRowClick(record);
    },
    [selectMode, toggle, handleRowClick],
  );

  // Render one queue row. Shared by the flat (single-line) case and the children
  // of a multi-product order group, so both paths resolve tester/packer + flags
  // identically. `stripeIndex` continues across a day (incl. group children) so
  // zebra striping stays consistent.
  const renderRow = useCallback(
    (record: ShippedOrder, stripeIndex: number) => {
      const r = record as QueueRowRecord;
      const testerName = useWaForDisplay
        ? getStaffName(r.tester_id as number | null | undefined)
        : (r.tested_by_name as string | undefined) ||
          (r.tester_name as string | undefined) ||
          getStaffName(r.tested_by as number | null | undefined) ||
          getStaffName(r.tester_id as number | null | undefined);
      const packerName = useWaForDisplay
        ? getStaffName(r.packer_id as number | null | undefined)
        : (r.packed_by_name as string | undefined) ||
          (r.packer_name as string | undefined) ||
          getStaffName(r.packed_by as number | null | undefined) ||
          getStaffName(r.packer_id as number | null | undefined);
      const outOfStockValue = String(r.out_of_stock || '').trim();
      const rowStatus = resolveRowStatus(r, queueMode);
      return (
        <OrdersQueueTableRow
          key={record.id}
          record={r}
          isSelected={selectMode ? selectedIds.has(Number(record.id)) : selectedRecord?.id === record.id}
          selectMode={selectMode}
          isChecked={selectMode && selectedIds.has(Number(record.id))}
          isMobile={isMobile}
          useAlternateStripe={stripeIndex % 2 === 0}
          testerDisplay={normalizePersonName(testerName)}
          packerDisplay={normalizePersonName(packerName)}
          testerId={useWaForDisplay ? (r.tester_id as number | null) : (r.tested_by as number | null) ?? (r.tester_id as number | null)}
          packerId={useWaForDisplay ? (r.packer_id as number | null) : (r.packed_by as number | null) ?? (r.packer_id as number | null)}
          rowStatus={rowStatus}
          trackingAction={queueMode === 'labels' ? <AddTrackingPopover record={record} /> : undefined}
          hasOutOfStock={outOfStockValue !== ''}
          outOfStockValue={outOfStockValue}
          daysLate={getDaysLateNullable(r.deadline_at as string | null | undefined)}
          onRowClick={handleRowAction}
        />
      );
    },
    [getStaffName, useWaForDisplay, selectMode, selectedIds, selectedRecord, isMobile, handleRowAction, queueMode],
  );

  useEffect(() => {
    const handleNavigate = (e: CustomEvent<{ direction?: 'up' | 'down' }>) => {
      if (!selectedRecord || displayedRecords.length === 0) return;

      const currentIndex = displayedRecords.findIndex((record) => Number(record.id) === Number(selectedRecord.id));
      if (currentIndex < 0) return;

      const step = e.detail?.direction === 'up' ? -1 : 1;
      const nextRecord = displayedRecords[currentIndex + step];
      if (!nextRecord) return;

      onOpenRecord?.(nextRecord);
      setSelectedRecord(nextRecord);
    };

    window.addEventListener('navigate-shipped-details' as any, handleNavigate as any);
    return () => {
      window.removeEventListener('navigate-shipped-details' as any, handleNavigate as any);
    };
  }, [displayedRecords, onOpenRecord, selectedRecord]);

  const totalCount = Object.values(groupedRecords).reduce((sum, dayRecords) => sum + dayRecords.length, 0);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
        {bannerTitle ? (
          <QueueTableBanner
            title={bannerTitle}
            subtitle={bannerSubtitle}
            compact={bannerCompact}
          />
        ) : (
          <div className="h-10 bg-white border-b border-gray-100 flex items-center px-4">
            <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
          </div>
        )}
        <div className="flex-1 overflow-y-auto no-scrollbar">
          <SkeletonList count={12} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 bg-white relative">
      <div className="flex-1 flex flex-col overflow-hidden">
        {bannerTitle ? (
          <QueueTableBanner
            title={bannerTitle}
            subtitle={bannerSubtitle}
            compact={bannerCompact}
            isRefreshing={isRefreshing}
          />
        ) : (
          <WeekHeader
            count={totalCount}
            weekRange={weekRange}
            weekOffset={weekOffset}
            onPrevWeek={onPrevWeek}
            onNextWeek={onNextWeek}
            rightSlot={
              !showWeekControls
                ? <div className="min-w-[18px] flex items-center justify-end">{isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" /> : null}</div>
                : undefined
            }
          />
        )}

        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto no-scrollbar w-full">
          {Object.keys(groupedRecords).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-40 text-center">
              {searchValue ? (
                <OrderSearchEmptyState
                  query={searchValue}
                  title={searchEmptyTitle}
                  resultLabel={searchResultLabel}
                  clearLabel={clearSearchLabel}
                  onClear={onClearSearch}
                />
              ) : (
                <div className="max-w-xs mx-auto animate-in fade-in zoom-in duration-300">
                  <p className="text-gray-500 font-semibold italic opacity-20">{emptyMessage}</p>
                  {showWeekControls && weekOffset > 0 && onResetWeek ? (
                    <button
                      type="button"
                      onClick={onResetWeek}
                      className={`mt-4 px-6 py-2 bg-gray-900 text-white ${sectionLabel} rounded-xl hover:bg-gray-800 transition-all active:scale-95`}
                    >
                      Go to Current Week
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col w-full">
              {orderGroupsByDate.map(([date, groups]) => {
                  // groups preserve the per-day sort order (groupRowsBy), matching
                  // displayedRecords so shift-range select lines up with the view.
                  // `stripeIndex` runs across the whole day (group children too).
                  let stripeIndex = 0;
                  const dayTotal = groups.reduce((sum, g) => sum + g.rows.length, 0);
                  return (
                    <div key={date} className="flex flex-col">
                      <DateGroupHeader date={date} total={dayTotal} />
                      {groups.map((group) => {
                        // Singleton order → a plain row (the common case).
                        if (group.rows.length === 1) {
                          const node = renderRow(group.rows[0], stripeIndex);
                          stripeIndex += 1;
                          return node;
                        }
                        // Multi-product order → one collapsed header, expand to
                        // reveal each product line. Different products, same order#.
                        const headerIndex = stripeIndex;
                        const children = group.rows.map((row) => {
                          const node = renderRow(row, stripeIndex);
                          stripeIndex += 1;
                          return node;
                        });
                        return (
                          <CollapsibleGroupRow
                            key={`order-${group.key}`}
                            index={headerIndex}
                            showChevron={false}
                            summary={<OrderGroupSummary rows={group.rows} isMobile={isMobile} />}
                          >
                            {children}
                          </CollapsibleGroupRow>
                        );
                      })}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
