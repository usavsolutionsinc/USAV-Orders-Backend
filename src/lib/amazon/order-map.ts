/**
 * Pure mappers: Amazon SP-API Order → local `orders`/`customers` shape.
 * No I/O — easy to unit-test.
 */
import type { AmazonOrderSummary, AmazonOrderItem, AmazonShippingAddress } from './client';

export type FulfillmentChannel = 'AFN' | 'MFN';

export function isFbaOrder(order: AmazonOrderSummary): boolean {
  return String(order.FulfillmentChannel || '').toUpperCase() === 'AFN';
}

export function fulfillmentChannelOf(order: AmazonOrderSummary): FulfillmentChannel {
  return isFbaOrder(order) ? 'AFN' : 'MFN';
}

/**
 * Map an Amazon OrderStatus → the local `orders.status` vocabulary.
 * FBA (AFN) orders are always 'shipped' (Amazon fulfilled them) so they stay
 * out of the pack/tech work surfaces; the AFN exclusion in /api/orders keeps
 * them off the unshipped to-do list too.
 */
export function mapAmazonStatus(amazonStatus: string | undefined, fba: boolean): string {
  if (fba) return 'shipped';
  switch (String(amazonStatus || '').trim()) {
    case 'Shipped':
      return 'shipped';
    case 'Canceled':
    case 'Unfulfillable':
      return 'canceled';
    case 'Pending':
    case 'PendingAvailability':
    case 'Unshipped':
    // PartiallyShipped: some items shipped, the rest still need fulfilment, so
    // it stays actionable on the unshipped/pack surface. Made explicit (was an
    // unlabeled fall-through) so the intent is clear and a future status added
    // to Amazon's vocabulary can't silently inherit this mapping.
    case 'PartiallyShipped':
    case 'InvoiceUnconfirmed':
      return 'unassigned';
    default:
      return 'unassigned';
  }
}

/** First line item (the representative row for the legacy one-row-per-order model). */
export function representativeItem(items: AmazonOrderItem[]): AmazonOrderItem | null {
  return items.find((i) => (i.SellerSKU || i.Title)) || items[0] || null;
}

export interface MappedCustomer {
  customerName: string | null;
  firstName: string | null;
  lastName: string | null;
  shippingAddress1: string | null;
  shippingAddress2: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingPostalCode: string | null;
  shippingCountry: string | null;
  phone: string | null;
}

export function mapShippingAddress(addr: AmazonShippingAddress | null | undefined): MappedCustomer | null {
  if (!addr) return null;
  const name = String(addr.Name || '').trim();
  const parts = name.split(/\s+/);
  return {
    customerName: name || null,
    firstName: parts[0] || null,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
    shippingAddress1: addr.AddressLine1 || null,
    shippingAddress2: addr.AddressLine2 || null,
    shippingCity: addr.City || null,
    shippingState: addr.StateOrRegion || null,
    shippingPostalCode: addr.PostalCode || null,
    shippingCountry: addr.CountryCode || null,
    phone: addr.Phone || null,
  };
}

/** A coarse overlap buffer so status transitions aren't missed between runs. */
export const WATERMARK_OVERLAP_MS = 15 * 60 * 1000;
export const FIRST_RUN_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
