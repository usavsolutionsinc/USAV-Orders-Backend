import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { deriveFulfillmentState, FULFILLMENT_STATE_META, UNSHIPPED_STATE_META } from '@/lib/unshipped-state';
import { OUTBOUND_STATE_META } from '@/lib/outbound-state';

export interface WeekRange {
  startStr: string;
  endStr: string;
}

/** A queue row plus the loosely-typed extra columns the various surfaces attach. */
export type QueueRowRecord = ShippedOrder & Record<string, unknown>;

/** Which surface owns this table — drives status dots and tracking affordances. */
export type OrdersQueueMode = 'fulfillment' | 'labels' | 'staged';

/** Sort order for the date-banded queue. `priority` (default) keeps the current
 *  behavior (soonest deadline, Awaiting-before-Pending within a day); `newest`
 *  bands by created date, most-recently-added first. */
export type OrdersQueueSort = 'priority' | 'newest';

export interface RowStatusMeta {
  dot: string;
  label: string;
  description: string;
}

/**
 * Format an order line's realized sale price (orders.sale_amount + currency)
 * for the row meta. Returns null when there's no amount so the slot stays
 * empty — most legacy orders have no price yet; only newly-ingested ones do.
 */
export function formatSalePrice(
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

/** Clean a tester/packer name, stripping role prefixes and placeholder values. */
export function normalizePersonName(value: unknown): string {
  const text = String(value ?? '')
    .replace(/^tech:\s*/i, '')
    .replace(/^packer:\s*/i, '')
    .trim();
  if (!text || /^(not specified|n\/a|null|undefined|staff\s*#\d+)$/i.test(text)) return '---';
  return text;
}

/** Resolve the status dot/label/description for a row given the owning surface. */
export function resolveRowStatus(record: QueueRowRecord, queueMode: OrdersQueueMode): RowStatusMeta {
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

/**
 * True when a row's latest carrier status indicates it has already moved into
 * the network (i.e. shipped) and should drop out of the queue. Rows with only a
 * created-label / unknown status remain visible.
 */
export function isShippedByLatestStatus(record: ShippedOrder): boolean {
  const category = String(record.latest_status_category ?? '').trim().toUpperCase();
  const label = String(record.latest_status_label ?? '').toUpperCase();
  const description = String(record.latest_status_description ?? '').toUpperCase();
  if (!category) {
    return label.includes('MOVING THROUGH NETWORK') || description.includes('MOVING THROUGH NETWORK');
  }
  return category !== 'LABEL_CREATED' && category !== 'UNKNOWN';
}
