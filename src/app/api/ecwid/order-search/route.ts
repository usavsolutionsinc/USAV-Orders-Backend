/**
 * GET /api/ecwid/order-search?q=<order# or keyword>[&limit=N]
 *
 * Live Ecwid order lookup for the repair-service linkage editor. The operator
 * types an order number (or customer name / email) and we resolve the ACTUAL
 * Ecwid order so the repair links to a real `source_order_id` instead of a
 * free-typed string.
 *
 * Deliberately UNFILTERED by fulfillment state: a repair can be linked to an
 * order whether or not it has shipped (most repair intakes reference an order
 * the customer already received). We therefore pass NO `fulfillmentStatus` /
 * `paymentStatus` filter to Ecwid — every matching order is returned, shipped
 * or not. This is the key difference from the order dashboards
 * (`/api/orders`, `/api/shipped/lookup-order`) which gate on carrier-shipped
 * state via `SHIPPED_BY_CARRIER_SQL`.
 *
 * Ecwid's `keywords` param searches across order number, customer name, email,
 * and item names (Ecwid REST v3 "Search orders"), so a partial order# resolves
 * the same way the storefront admin search does. Exact order-number matches are
 * floated to the top.
 *
 * Response (mirrors a thin order candidate the picker renders directly):
 *   {
 *     success: true,
 *     orders: [{
 *       ecwidOrderId,      // Ecwid internal id (stable)
 *       orderNumber,       // the value to persist as source_order_id (public #)
 *       displayNumber,     // human label, e.g. "USAV-10421" or "#10421"
 *       date,              // ISO order-placed timestamp | null
 *       customerName,      // billing/shipping person name | null
 *       email,             // customer email | null
 *       total,             // order total | null
 *       paymentStatus,     // raw Ecwid status (shown, never filtered on)
 *       fulfillmentStatus, // raw Ecwid status (shown, never filtered on)
 *       itemCount,
 *       firstItemName,
 *       firstItemSku,
 *     }]
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';

const ECWID_BASE_URL = 'https://app.ecwid.com/api/v3';
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 50;

interface EcwidPerson {
  name?: string | null;
}

interface EcwidOrderItem {
  sku?: string | null;
  name?: string | null;
  quantity?: number | null;
}

interface EcwidOrder {
  id?: number | string | null;
  orderNumber?: number | string | null;
  /** Public-facing order number incl. store prefix, when configured. */
  vendorOrderNumber?: string | null;
  email?: string | null;
  total?: number | null;
  paymentStatus?: string | null;
  fulfillmentStatus?: string | null;
  createDate?: string | null;
  created?: string | null;
  billingPerson?: EcwidPerson | null;
  shippingPerson?: EcwidPerson | null;
  items?: EcwidOrderItem[] | null;
}

interface OrderCandidate {
  ecwidOrderId: string;
  orderNumber: string;
  displayNumber: string;
  date: string | null;
  customerName: string | null;
  email: string | null;
  total: number | null;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  itemCount: number;
  firstItemName: string | null;
  firstItemSku: string | null;
}

/** Resolve a required env var across the project's Ecwid aliases (see recent-repair-orders). */
function requiredEnv(primary: string, aliases: string[] = []): string {
  for (const key of [primary, ...aliases]) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  throw new Error(`Missing required environment variable: ${primary}`);
}

/** Compare two order numbers ignoring case, whitespace and a leading '#'. */
function normalizeOrderNumber(value: string): string {
  return value.trim().replace(/^#/, '').toLowerCase();
}

function toCandidate(order: EcwidOrder): OrderCandidate | null {
  const rawNumber =
    order.vendorOrderNumber != null && String(order.vendorOrderNumber).trim() !== ''
      ? String(order.vendorOrderNumber).trim()
      : order.orderNumber != null
        ? String(order.orderNumber).trim()
        : '';
  if (!rawNumber) return null;

  const items = Array.isArray(order.items) ? order.items : [];
  const first = items[0];
  const customerName =
    order.billingPerson?.name?.trim() ||
    order.shippingPerson?.name?.trim() ||
    null;

  return {
    ecwidOrderId: order.id != null ? String(order.id) : rawNumber,
    orderNumber: rawNumber,
    displayNumber: rawNumber.startsWith('#') ? rawNumber : `#${rawNumber}`,
    date: order.createDate || order.created || null,
    customerName,
    email: order.email?.trim() || null,
    total: typeof order.total === 'number' ? order.total : null,
    paymentStatus: order.paymentStatus || null,
    fulfillmentStatus: order.fulfillmentStatus || null,
    itemCount: items.length,
    firstItemName: first?.name?.trim() || null,
    firstItemSku: first?.sku?.trim() || null,
  };
}

export const GET = withAuth(async (request: NextRequest) => {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || '').trim();
  const limit = Math.max(
    1,
    Math.min(MAX_LIMIT, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT),
  );

  // Sub-2-char queries would return the whole store — wait for a usable term.
  if (query.length < 2) {
    return NextResponse.json({ success: true, orders: [] });
  }

  let storeId: string;
  let token: string;
  try {
    storeId = requiredEnv('ECWID_STORE_ID', [
      'ECWID_STOREID',
      'ECWID_STORE',
      'NEXT_PUBLIC_ECWID_STORE_ID',
    ]);
    token = requiredEnv('ECWID_API_TOKEN', [
      'ECWID_TOKEN',
      'ECWID_ACCESS_TOKEN',
      'NEXT_PUBLIC_ECWID_API_TOKEN',
    ]);
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Ecwid credentials not configured',
      },
      { status: 500 },
    );
  }

  // NOTE: only `keywords` + `limit` are sent. No fulfillment/payment status
  // filter → shipped AND unshipped orders both come back, by design.
  const ecwidUrl = new URL(`${ECWID_BASE_URL}/${storeId}/orders`);
  ecwidUrl.searchParams.set('keywords', query);
  ecwidUrl.searchParams.set('limit', String(limit));

  let payload: { items?: EcwidOrder[] };
  try {
    const res = await fetch(ecwidUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json(
        { success: false, error: `Ecwid orders API ${res.status}`, detail: text.slice(0, 300) },
        { status: 502 },
      );
    }
    payload = (await res.json()) as { items?: EcwidOrder[] };
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Ecwid request failed' },
      { status: 502 },
    );
  }

  const want = normalizeOrderNumber(query);
  const orders = (Array.isArray(payload.items) ? payload.items : [])
    .map(toCandidate)
    .filter((c): c is OrderCandidate => c !== null)
    // Float exact order-number matches to the top; Ecwid already returns the
    // rest newest-first.
    .sort((a, b) => {
      const aExact = normalizeOrderNumber(a.orderNumber) === want ? 0 : 1;
      const bExact = normalizeOrderNumber(b.orderNumber) === want ? 0 : 1;
      return aExact - bExact;
    });

  return NextResponse.json({ success: true, orders });
}, { permission: 'repair.view' });
