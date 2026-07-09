/**
 * eBay Buy Order API adapter — the ONE place that knows the buyer purchase-order
 * API shape. Universal Incoming Track A (plan §5.1).
 *
 * ⚠ RESTRICTED SCOPE: eBay's Buy Order API (getPurchaseOrder) requires
 * `buy.order.readonly`, which needs separate eBay business approval. Until the app
 * is approved AND the endpoint is wired, `fetchBuyerPurchaseOrders` returns [] so
 * the purchase-sync cron is a safe no-op. Track B — the manual bridge import
 * (`POST /api/receiving/inbound/import-ebay`) — is the working path today and
 * writes the SAME shape (`ingestPurchase`), so bridge rows upgrade in place when
 * this adapter goes live.
 *
 * When approved: read the buyer token (readEbayToken), call the Buy Order API with
 * the buyer scopes (ebayScopeStringForRole('buyer')), and normalize each order
 * line into a BuyerPurchaseLine. Keep ALL eBay-API-shape knowledge in this file.
 */

import type { OrgId } from '@/lib/tenancy/constants';

/** A normalized purchase-order line — the neutral shape the sync ingests. */
export interface BuyerPurchaseLine {
  /** eBay order id (the Incoming dedup identity). */
  sourceOrderId: string;
  sourceLineItemId?: string | null;
  sku?: string | null;
  itemName?: string | null;
  quantity?: number;
  conditionGrade?: string | null;
  sellerUsername?: string | null;
  legacyOrderId?: string | null;
  purchaseOrderStatus?: string | null;
  paymentStatus?: string | null;
  listingUrl?: string | null;
  trackingNumber?: string | null;
  carrierCode?: string | null;
  orderNumber?: string | null;
  vendorOrSellerName?: string | null;
}

/** A connected buyer account to pull purchases for. */
export interface BuyerAccountRef {
  accountName: string;
}

/**
 * Fetch a buyer account's purchase-order lines modified since `sinceIso` (delta).
 * Returns [] until the Buy Order API is approved + wired (Track A) — the sync
 * treats an empty pull as "nothing new", so this is a safe no-op, not an error.
 */
export async function fetchBuyerPurchaseOrders(
  _orgId: OrgId,
  _account: BuyerAccountRef,
  _sinceIso: string | null,
): Promise<BuyerPurchaseLine[]> {
  // TODO(track-a): implement against the eBay Buy Order API once buy.order.readonly
  // is approved. Read the buyer token, paginate purchase orders, map each open
  // line to a BuyerPurchaseLine. Until then, no-op so the cron never faults.
  return [];
}
