/**
 * eBay buyer purchase adapter — the ONE place that knows buyer purchase-order
 * API shapes. Universal Incoming Track A (plan §5.1).
 *
 * Discovery: Trading API GetOrders with OrderRole=Buyer (Buy Order API cannot
 * list purchases — getPurchaseOrder is ID-only). Enrich: Buy Order
 * GET /buy/order/v1/purchase_order/{id} when a purchaseOrderId is already known
 * (Track B / sync-one).
 *
 * Token: readEbayToken + refresh with ebayScopeStringForRole('buyer') so a
 * buyer refresh never silently downgrades to seller scopes.
 */

import { XMLParser } from 'fast-xml-parser';
import type { OrgId } from '@/lib/tenancy/constants';
import { tenantQuery } from '@/lib/tenancy/db';
import { getEbayAppCreds, EBAY_PLATFORM_PREDICATE } from './credentials';
import {
  ebayScopeStringForRole,
  isEbaySandbox,
  type EbayEnvironment,
} from './oauth-config';
import { readEbayToken, refreshEbayAccessToken, writeEbayToken } from './token-refresh';

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

// ─── Pure helpers (exported for unit tests) ─────────────────────────────────

/** Coerce eBay XML singletons / arrays into a flat array. */
export function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function str(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function num(value: unknown, fallback = 1): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface ShipmentTracking {
  trackingNumber: string | null;
  carrierCode: string | null;
}

/**
 * Pull the first usable tracking pair from a Trading ShippingDetails-like
 * container (order- or transaction-level ShipmentTrackingDetails).
 */
export function extractTradingShipmentTracking(shippingDetails: unknown): ShipmentTracking {
  const details = (shippingDetails ?? {}) as Record<string, unknown>;
  const rows = asArray(details.ShipmentTrackingDetails as Record<string, unknown> | Record<string, unknown>[] | undefined);
  for (const row of rows) {
    const trackingNumber = str(row?.ShipmentTrackingNumber);
    const carrierCode = str(row?.ShippingCarrierUsed);
    if (trackingNumber || carrierCode) {
      return { trackingNumber, carrierCode };
    }
  }
  return { trackingNumber: null, carrierCode: null };
}

function listingUrlFromItem(item: Record<string, unknown> | null | undefined): string | null {
  if (!item) return null;
  const direct = str(item.ViewItemURL) ?? str(item.ViewItemURLForNaturalSearch);
  if (direct) return direct;
  const itemId = str(item.ItemID);
  return itemId ? `https://www.ebay.com/itm/${itemId}` : null;
}

/**
 * Map one Trading GetOrders Order node → BuyerPurchaseLine[] (one per
 * Transaction). Order-level tracking is the fallback when a transaction has none.
 */
export function mapTradingOrderToBuyerLines(order: Record<string, unknown>): BuyerPurchaseLine[] {
  const sourceOrderId = str(order.OrderID) ?? str(order.ExtendedOrderID);
  if (!sourceOrderId) return [];

  const sellerUsername = str(order.SellerUserID);
  const purchaseOrderStatus = str(order.OrderStatus);
  const checkout = (order.CheckoutStatus ?? {}) as Record<string, unknown>;
  const paymentStatus = str(checkout.Status) ?? (order.PaidTime ? 'Paid' : null);
  const orderTracking = extractTradingShipmentTracking(order.ShippingDetails);

  const transactions = asArray(
    (order.TransactionArray as { Transaction?: unknown } | undefined)?.Transaction as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined,
  );

  if (transactions.length === 0) {
    return [{
      sourceOrderId,
      sellerUsername,
      purchaseOrderStatus,
      paymentStatus,
      trackingNumber: orderTracking.trackingNumber,
      carrierCode: orderTracking.carrierCode,
      orderNumber: sourceOrderId,
      vendorOrSellerName: sellerUsername,
      quantity: 1,
    }];
  }

  return transactions.map((tx) => {
    const item = (tx.Item ?? {}) as Record<string, unknown>;
    const txTracking = extractTradingShipmentTracking(tx.ShippingDetails);
    const trackingNumber = txTracking.trackingNumber ?? orderTracking.trackingNumber;
    const carrierCode = txTracking.carrierCode ?? orderTracking.carrierCode;
    const orderLineItemId = str(tx.OrderLineItemID);
    const legacyOrderId = orderLineItemId ?? str(order.ExtendedOrderID) ?? sourceOrderId;

    return {
      sourceOrderId,
      sourceLineItemId: orderLineItemId ?? str(tx.TransactionID),
      sku: str(item.SKU),
      itemName: str(item.Title),
      quantity: num(tx.QuantityPurchased, 1),
      conditionGrade: str(item.ConditionDisplayName) ?? str(item.ConditionID),
      sellerUsername,
      legacyOrderId,
      purchaseOrderStatus,
      paymentStatus,
      listingUrl: listingUrlFromItem(item),
      trackingNumber,
      carrierCode,
      orderNumber: sourceOrderId,
      vendorOrSellerName: sellerUsername,
    };
  });
}

/** Map a parsed GetOrdersResponse (or OrderArray) into BuyerPurchaseLine[]. */
export function mapTradingOrdersToBuyerLines(orders: unknown): BuyerPurchaseLine[] {
  const list = asArray(orders as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const out: BuyerPurchaseLine[] = [];
  for (const order of list) {
    out.push(...mapTradingOrderToBuyerLines(order));
  }
  return out;
}

export interface ParsedGetOrdersResponse {
  ack: string | null;
  hasMoreOrders: boolean;
  pageNumber: number;
  orders: Record<string, unknown>[];
  errorMessage: string | null;
}

const tradingXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Keep numeric-looking IDs as strings when possible — ItemID etc. can exceed
  // JS safe integers; text nodes that look like numbers still parse as numbers
  // for small values, so mappers always coerce via str().
  isArray: (name) =>
    name === 'Order'
    || name === 'Transaction'
    || name === 'ShipmentTrackingDetails'
    || name === 'Error'
    || name === 'Errors',
});

/** Parse Trading GetOrders XML into a normalized response bag. */
export function parseTradingGetOrdersXml(xml: string): ParsedGetOrdersResponse {
  const doc = tradingXmlParser.parse(xml) as Record<string, unknown>;
  const root = (doc.GetOrdersResponse ?? doc) as Record<string, unknown>;
  const ack = str(root.Ack);
  const errors = asArray(root.Errors as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const errorMessage = errors
    .map((e) => str(e.LongMessage) ?? str(e.ShortMessage))
    .filter(Boolean)
    .join('; ') || null;

  const orderArray = (root.OrderArray ?? {}) as { Order?: unknown };
  const orders = asArray(orderArray.Order as Record<string, unknown> | Record<string, unknown>[] | undefined);

  const hasMoreRaw = root.HasMoreOrders;
  const hasMoreOrders = hasMoreRaw === true || hasMoreRaw === 'true' || hasMoreRaw === 1 || hasMoreRaw === '1';
  const pageNumber = Number((root.PageNumber as unknown) ?? 1) || 1;

  return { ack, hasMoreOrders, pageNumber, orders, errorMessage };
}

/**
 * Map Buy Order API getPurchaseOrder JSON → BuyerPurchaseLine[].
 * Tracking prefers shippingFulfillments[].shipmentTrackingNumber matched to the
 * line; falls back to line.shippingDetail.shippingCarrierCode (carrier only).
 */
export function mapBuyPurchaseOrderToBuyerLines(po: Record<string, unknown>): BuyerPurchaseLine[] {
  const purchaseOrderId = str(po.purchaseOrderId);
  if (!purchaseOrderId) return [];

  const purchaseOrderStatus = str(po.purchaseOrderStatus);
  const paymentStatus = str(po.purchaseOrderPaymentStatus);

  const fulfillments = asArray(
    po.shippingFulfillments as Record<string, unknown> | Record<string, unknown>[] | undefined,
  );

  function trackingForLine(lineItemId: string | null): ShipmentTracking {
    for (const f of fulfillments) {
      const refs = asArray(
        f.lineItemReferences as Record<string, unknown> | Record<string, unknown>[] | undefined,
      );
      const matches = !lineItemId
        || refs.length === 0
        || refs.some((r) => str(r.lineItemId) === lineItemId);
      if (!matches) continue;
      const trackingNumber = str(f.shipmentTrackingNumber);
      const carrierCode = str(f.shippingCarrierCode);
      if (trackingNumber || carrierCode) return { trackingNumber, carrierCode };
    }
    return { trackingNumber: null, carrierCode: null };
  }

  const lineItems = asArray(po.lineItems as Record<string, unknown> | Record<string, unknown>[] | undefined);
  if (lineItems.length === 0) {
    const t = trackingForLine(null);
    return [{
      sourceOrderId: purchaseOrderId,
      purchaseOrderStatus,
      paymentStatus,
      trackingNumber: t.trackingNumber,
      carrierCode: t.carrierCode,
      orderNumber: purchaseOrderId,
      quantity: 1,
    }];
  }

  return lineItems.map((line) => {
    const lineItemId = str(line.lineItemId);
    const legacy = (line.legacyReference ?? {}) as Record<string, unknown>;
    const seller = (line.seller ?? {}) as Record<string, unknown>;
    const shippingDetail = (line.shippingDetail ?? {}) as Record<string, unknown>;
    const fromFulfillment = trackingForLine(lineItemId);
    const sellerUsername = str(seller.username);
    const itemId = str(line.itemId);
    const legacyItemId = str(legacy.legacyItemId);

    return {
      sourceOrderId: purchaseOrderId,
      sourceLineItemId: lineItemId,
      sku: legacyItemId,
      itemName: str(line.title),
      quantity: num(line.quantity, 1),
      sellerUsername,
      legacyOrderId: str(legacy.legacyOrderId) ?? str(line.orderId),
      purchaseOrderStatus: str(line.lineItemStatus) ?? purchaseOrderStatus,
      paymentStatus: str(line.lineItemPaymentStatus) ?? paymentStatus,
      listingUrl: legacyItemId
        ? `https://www.ebay.com/itm/${legacyItemId}`
        : itemId
          ? `https://www.ebay.com/itm/${itemId}`
          : null,
      trackingNumber: fromFulfillment.trackingNumber,
      carrierCode: fromFulfillment.carrierCode ?? str(shippingDetail.shippingCarrierCode),
      orderNumber: str(line.orderId) ?? purchaseOrderId,
      vendorOrSellerName: sellerUsername,
    };
  });
}

// ─── Token + HTTP ───────────────────────────────────────────────────────────

const TRADING_COMPAT_LEVEL = '1113';
const GET_ORDERS_PAGE_SIZE = 100;
/** ModTimeFrom/To max window is 30 days; clamp delta cursors accordingly. */
const MOD_TIME_MAX_MS = 30 * 24 * 60 * 60 * 1000;
/** First-pull lookback when no cursor exists. */
const INITIAL_LOOKBACK_DAYS = 30;

function tradingEndpoint(sandbox: boolean): string {
  return sandbox
    ? 'https://api.sandbox.ebay.com/ws/api.dll'
    : 'https://api.ebay.com/ws/api.dll';
}

function buyApiBase(sandbox: boolean): string {
  return sandbox ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toEbayIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

/** Build ModTimeFrom (or NumberOfDays for first pull) for GetOrders. */
export function buildGetOrdersDateFilter(sinceIso: string | null, nowMs = Date.now()): {
  modTimeFrom?: string;
  numberOfDays?: number;
} {
  if (!sinceIso) {
    return { numberOfDays: INITIAL_LOOKBACK_DAYS };
  }
  const sinceMs = new Date(sinceIso).getTime();
  if (!Number.isFinite(sinceMs)) {
    return { numberOfDays: INITIAL_LOOKBACK_DAYS };
  }
  const floor = nowMs - MOD_TIME_MAX_MS;
  const fromMs = Math.max(sinceMs, floor);
  return { modTimeFrom: toEbayIso(new Date(fromMs)) };
}

export function buildGetOrdersRequestXml(opts: {
  pageNumber: number;
  sinceIso: string | null;
  nowMs?: number;
}): string {
  const filter = buildGetOrdersDateFilter(opts.sinceIso, opts.nowMs);
  const dateXml = filter.modTimeFrom
    ? `<ModTimeFrom>${escapeXml(filter.modTimeFrom)}</ModTimeFrom>`
    : `<NumberOfDays>${filter.numberOfDays ?? INITIAL_LOOKBACK_DAYS}</NumberOfDays>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<GetOrdersRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <OrderRole>Buyer</OrderRole>
  <OrderStatus>All</OrderStatus>
  ${dateXml}
  <Pagination>
    <EntriesPerPage>${GET_ORDERS_PAGE_SIZE}</EntriesPerPage>
    <PageNumber>${Math.max(1, opts.pageNumber)}</PageNumber>
  </Pagination>
</GetOrdersRequest>`;
}

interface BuyerTokenContext {
  accessToken: string;
  sandbox: boolean;
  environment: EbayEnvironment;
}

async function getValidBuyerAccessToken(
  orgId: OrgId,
  accountName: string,
): Promise<BuyerTokenContext> {
  const creds = await getEbayAppCreds(orgId);
  if (!creds) {
    throw new Error(`No eBay app credentials configured for organization ${orgId}`);
  }
  const sandbox = isEbaySandbox(creds.environment);

  const result = await tenantQuery<{
    access_token: string;
    refresh_token: string;
    token_expires_at: string | Date | null;
  }>(
    orgId,
    `SELECT access_token, refresh_token, token_expires_at
       FROM ebay_accounts
      WHERE organization_id = $1
        AND account_name = $2
        AND account_role = 'buyer'
        AND is_active = true
        AND ${EBAY_PLATFORM_PREDICATE}
      LIMIT 1`,
    [orgId, accountName],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`eBay buyer account "${accountName}" not found or inactive`);
  }

  const accessToken = readEbayToken(row.access_token);
  const refreshToken = readEbayToken(row.refresh_token);
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at) : new Date(0);
  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);

  if (expiresAt >= fiveMinutesFromNow) {
    return { accessToken, sandbox, environment: creds.environment };
  }

  const { accessToken: fresh, expiresIn } = await refreshEbayAccessToken(
    creds.appId,
    creds.certId,
    refreshToken,
    creds.environment,
    ebayScopeStringForRole('buyer'),
  );
  const newExpiresAt = new Date(Date.now() + expiresIn * 1000);
  await tenantQuery(
    orgId,
    `UPDATE ebay_accounts
        SET access_token = $1, token_expires_at = $2, updated_at = NOW()
      WHERE organization_id = $3 AND account_name = $4`,
    [writeEbayToken(fresh), newExpiresAt, orgId, accountName],
  );

  return { accessToken: fresh, sandbox, environment: creds.environment };
}

async function callTradingGetOrdersPage(opts: {
  accessToken: string;
  sandbox: boolean;
  pageNumber: number;
  sinceIso: string | null;
  fetchImpl?: typeof fetch;
}): Promise<ParsedGetOrdersResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = buildGetOrdersRequestXml({
    pageNumber: opts.pageNumber,
    sinceIso: opts.sinceIso,
  });

  const res = await fetchImpl(tradingEndpoint(opts.sandbox), {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      'X-EBAY-API-CALL-NAME': 'GetOrders',
      'X-EBAY-API-SITEID': '0',
      'X-EBAY-API-COMPATIBILITY-LEVEL': TRADING_COMPAT_LEVEL,
      'X-EBAY-API-IAF-TOKEN': opts.accessToken,
    },
    body,
  });

  const xml = await res.text();
  if (!res.ok) {
    throw new Error(`Trading GetOrders failed: HTTP ${res.status} ${xml.slice(0, 240)}`);
  }

  const parsed = parseTradingGetOrdersXml(xml);
  if (parsed.ack && /failure/i.test(parsed.ack)) {
    throw new Error(
      `Trading GetOrders Ack=${parsed.ack}${parsed.errorMessage ? `: ${parsed.errorMessage}` : ''}`,
    );
  }
  return parsed;
}

/**
 * Fetch a buyer account's purchase-order lines modified since `sinceIso` (delta)
 * via Trading GetOrders OrderRole=Buyer. Paginates until HasMoreOrders is false.
 */
export async function fetchBuyerPurchaseOrders(
  orgId: OrgId,
  account: BuyerAccountRef,
  sinceIso: string | null,
): Promise<BuyerPurchaseLine[]> {
  const { accessToken, sandbox } = await getValidBuyerAccessToken(orgId, account.accountName);
  const lines: BuyerPurchaseLine[] = [];
  let pageNumber = 1;
  let hasMore = true;

  while (hasMore) {
    const page = await callTradingGetOrdersPage({
      accessToken,
      sandbox,
      pageNumber,
      sinceIso,
    });
    lines.push(...mapTradingOrdersToBuyerLines(page.orders));
    hasMore = page.hasMoreOrders;
    pageNumber += 1;
    // Safety: eBay caps ~100/page; refuse runaway pagination.
    if (pageNumber > 50) break;
  }

  return lines;
}

/**
 * Enrich a known purchase-order id via Buy Order API getPurchaseOrder.
 * Requires buy.order.readonly on the buyer token.
 */
export async function fetchBuyerPurchaseOrderById(
  orgId: OrgId,
  account: BuyerAccountRef,
  purchaseOrderId: string,
): Promise<BuyerPurchaseLine[]> {
  const id = String(purchaseOrderId ?? '').trim();
  if (!id) return [];

  const { accessToken, sandbox } = await getValidBuyerAccessToken(orgId, account.accountName);
  const url = `${buyApiBase(sandbox)}/buy/order/v1/purchase_order/${encodeURIComponent(id)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  });

  if (res.status === 404) return [];
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Buy getPurchaseOrder failed: HTTP ${res.status} ${text.slice(0, 240)}`);
  }

  const po = (await res.json()) as Record<string, unknown>;
  return mapBuyPurchaseOrderToBuyerLines(po);
}
