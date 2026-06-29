'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import { Check } from '@/components/Icons';
import { OrderIdentityChips } from '@/components/ui/OrderIdentityChips';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { StaffInitials } from '@/design-system/components/StaffBadge';
import { RowTitle, RowMetaColumns, META_COL } from '@/components/ui/RowMetaColumns';
import { getOrderPlatformColor, getOrderPlatformBorderColor, isFbaOrder } from '@/utils/order-platform';
import { useOrderChannelLabel } from '@/hooks/useCatalog';
import { getExternalUrlByItemNumber, skuScanPrefixBeforeColon } from '@/hooks/useExternalItemUrl';
import { getDaysLateTone } from '@/utils/date';
import { isSkuSourceRecord } from '@/utils/source-dot';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { dashboardOrderRowShellClass } from '@/lib/dashboard-order-row-layout';
import { formatSalePrice, type QueueRowRecord, type RowStatusMeta } from './helpers';

export interface OrdersQueueTableRowProps {
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
}

/** Memoized row: when React Query merges one updated order, unrelated rows skip re-render. */
export const OrdersQueueTableRow = memo(function OrdersQueueTableRow({
  record,
  isSelected,
  selectMode,
  isChecked,
  useAlternateStripe,
  rowStatus,
  trackingAction,
  hasOutOfStock,
  outOfStockValue,
  daysLate,
  testerDisplay,
  packerDisplay,
  testerId,
  packerId,
  isMobile,
  onRowClick,
}: OrdersQueueTableRowProps) {
  const orderChannelLabel = useOrderChannelLabel();
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
  const platformLabel = orderChannelLabel(record.order_id || '', record.account_source);
  const isFba = isFbaOrder(record.order_id, record.account_source);
  const platformColor = platformLabel ? getOrderPlatformColor(platformLabel) : '';
  const productPageUrl = getExternalUrlByItemNumber(
    String(record.item_number || '').trim() || skuScanPrefixBeforeColon(trackingRaw),
  );
  const salePrice = formatSalePrice(record.sale_amount, record.currency);
  // Assigned staff, surfaced contextually so the `staff` sort is legible in-row.
  // Rendered as the shared two-initial badge display (StaffInitials) — the SAME
  // tester+packer presentation the Shipped/packed table uses, so the Unshipped /
  // Tested lanes match it. Both slots always render (muted "--" when unassigned)
  // so the column stays rigid across rows.
  const hasTester = testerDisplay && testerDisplay !== '---';
  const hasPacker = packerDisplay && packerDisplay !== '---';
  // Phase-5 governing-event projection (orders.label_printed_at): glanceable
  // "done" dot, shown only once the timestamp is stamped.
  const labelPrintedAt = record.label_printed_at;

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
              <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
                {hasTester ? (
                  <HoverTooltip label={`Tested by ${testerDisplay}`} focusable={false}>
                    <StaffInitials staffId={testerId} name={testerDisplay} />
                  </HoverTooltip>
                ) : (
                  <StaffInitials staffId={testerId} name={testerDisplay} />
                )}
                {hasPacker ? (
                  <HoverTooltip label={`Packed by ${packerDisplay}`} focusable={false}>
                    <StaffInitials staffId={packerId} name={packerDisplay} />
                  </HoverTooltip>
                ) : (
                  <StaffInitials staffId={packerId} name={packerDisplay} />
                )}
              </span>
              {hasOutOfStock ? (
                <span className="text-red-600">{outOfStockValue}</span>
              ) : null}
              {labelPrintedAt ? (
                <HoverTooltip label="Label printed" focusable={false}>
                  <span className="flex items-center gap-1 text-emerald-600">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    LBL
                  </span>
                </HoverTooltip>
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
  if (prev.record.label_printed_at !== next.record.label_printed_at) return false;
  return true;
});
