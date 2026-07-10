import type { ShippedOrder } from '@/lib/neon/orders-queries';
import type { WorkOrderRow } from '@/components/work-orders/types';
import type { DeleteOrderRowPayload } from '@/hooks/useDeleteOrderRow';
import { getStaffName } from '@/utils/staff';
import { toPSTDateKey } from '@/utils/date';
import { resolveFulfillmentLane, hasLeftWarehouse } from '@/lib/order-lifecycle';

/**
 * Has this order shipped (left the warehouse)? The canonical "post-dock" test —
 * scanned out at the dock, or the carrier already has custody
 * (accepted/in-transit/out-for-delivery/delivered/returned), or a derived
 * shipped/delivered flag. Gates edits that must freeze once an order is gone
 * (e.g. the condition grade — you can't re-grade what already shipped).
 */
export function isOrderShipped(shipped: ShippedOrder): boolean {
  if (shipped.is_shipped === true || shipped.is_delivered === true) return true;
  return hasLeftWarehouse({
    shipConfirmedAt: shipped.ship_confirmed_at ?? null,
    latestStatusCategory: shipped.latest_status_category ?? null,
  });
}

/** Build the work-order assignment row model for a shipped order. */
export function buildAssignmentRow(shipped: ShippedOrder): WorkOrderRow {
  return {
    id: `ORDER:${shipped.id}`,
    entityType: 'ORDER',
    entityId: Number(shipped.id),
    queueKey: 'orders',
    queueLabel: 'Orders',
    title: shipped.product_title || 'Untitled order',
    subtitle: [shipped.order_id, shipped.shipping_tracking_number, shipped.sku].filter(Boolean).join(' • '),
    recordLabel: shipped.order_id || shipped.item_number || `Order #${shipped.id}`,
    sourcePath: '/dashboard',
    techId: shipped.tester_id ?? null,
    techName: shipped.tester_name || null,
    packerId: shipped.packer_id ?? null,
    packerName: shipped.packed_by_name || null,
    status: 'ASSIGNED',
    priority: 100,
    deadlineAt: shipped.ship_by_date || shipped.deadline_at || null,
    notes: shipped.notes || null,
    assignedAt: null,
    updatedAt: shipped.created_at || null,
    orderId: shipped.order_id || null,
    trackingNumber: shipped.shipping_tracking_number || null,
    itemNumber: shipped.item_number || null,
    sku: shipped.sku || null,
    condition: shipped.condition || null,
    shipmentId: shipped.shipment_id ?? null,
    accountSource: shipped.account_source || null,
    quantity: shipped.quantity || null,
    createdAt: shipped.created_at || null,
  };
}

export type StatusTone = 'emerald' | 'red' | 'yellow';

export interface ShippedHeaderMeta {
  outOfStockValue: string;
  hasOutOfStock: boolean;
  testedById: number | null;
  canEditAssignment: boolean;
  hasTechScan: boolean;
  statusTone: StatusTone;
  statusLabel: string;
  orderIdTrimmed: string;
  showExceptionsFallback: boolean;
  orderIdDisplay: string;
}

/**
 * Derive the header status pill + order-id display for a shipped order. When no
 * canonical `order_id` is present (exceptions rows, partial intake), the header
 * falls back to the absolute table id rendered as an EXCEPTIONS reference.
 */
export function deriveShippedHeaderMeta(shipped: ShippedOrder): ShippedHeaderMeta {
  const outOfStockValue = String((shipped as any).out_of_stock || '').trim();
  const hasOutOfStock = outOfStockValue !== '';
  const testedById = shipped.tested_by ?? null;
  const canEditAssignment = Number(shipped.id) > 0 && (shipped as any).row_source !== 'exception';
  const hasTechScan = Boolean((shipped as any).has_tech_scan);
  // State decision flows through the canonical fulfillment projection so this
  // header pill can never disagree with the order's board lane (the projection
  // is exception‑first: out‑of‑stock → BLOCKED wins over a tech scan). Tone +
  // label below are presentation only.
  const lane = resolveFulfillmentLane({ hasTechScan, outOfStock: outOfStockValue });
  const statusTone: StatusTone = lane === 'TESTED' ? 'emerald' : lane === 'BLOCKED' ? 'red' : 'yellow';
  const statusLabel =
    lane === 'TESTED'
      ? `Tested by ${getStaffName(testedById)}`
      : lane === 'BLOCKED'
        ? outOfStockValue
        : 'Pending';
  const orderIdTrimmed = String(shipped.order_id || '').trim();
  const showExceptionsFallback = !orderIdTrimmed;
  const orderIdDisplay = orderIdTrimmed || String(Math.abs(Number(shipped.id)));

  return {
    outOfStockValue,
    hasOutOfStock,
    testedById,
    canEditAssignment,
    hasTechScan,
    statusTone,
    statusLabel,
    orderIdTrimmed,
    showExceptionsFallback,
    orderIdDisplay,
  };
}

/**
 * Resolve which delete request a shipped row maps to, or null when the row id
 * is invalid. Negative ids and `row_source === 'exception'` delete the
 * exception; FBA/FNSKU/SKU/SCAN tracking types (or activity-log-keyed rows)
 * delete the packing log; everything else deletes the order.
 */
export function resolveDeleteRequest(shipped: ShippedOrder): DeleteOrderRowPayload | null {
  const rowId = Number(shipped.id);
  const isExceptionRow = (shipped as any).row_source === 'exception' || rowId < 0;
  const targetId = isExceptionRow ? Math.abs(rowId) : rowId;
  if (!Number.isFinite(targetId) || targetId <= 0) return null;

  if (isExceptionRow) {
    return { rowSource: 'exception', exceptionId: targetId };
  }

  const normalizedTrackingType = String((shipped as any).tracking_type || '').toUpperCase();
  const activityLogId = Number((shipped as any).station_activity_log_id || (shipped as any).sal_id) || undefined;
  const packerLogId = Number((shipped as any).packer_log_id) || undefined;
  const isLikelyActivityLogRow = activityLogId != null && Number(activityLogId) === Number(shipped.id);
  const shouldDeletePackingLog =
    normalizedTrackingType === 'FBA' ||
    normalizedTrackingType === 'FNSKU' ||
    normalizedTrackingType === 'SKU' ||
    normalizedTrackingType === 'SCAN' ||
    isLikelyActivityLogRow;

  if (shouldDeletePackingLog) {
    return { rowSource: 'packing_log', activityLogId, packerLogId };
  }
  return { rowSource: 'order', orderId: targetId };
}

/** Format a date value to `MM-DD-YY` in PST, or '' when absent/unparseable. */
export function toMonthDayYearCurrent(value: string | null | undefined): string {
  if (!value) return '';
  const pstDateKey = toPSTDateKey(value);
  if (!pstDateKey) return '';
  const [year, month, day] = pstDateKey.split('-').map(Number);
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}-${String(year % 100).padStart(2, '0')}`;
}
