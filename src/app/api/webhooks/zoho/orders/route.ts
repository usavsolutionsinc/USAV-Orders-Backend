import { NextRequest, NextResponse } from 'next/server';
import { ingestOrder, type OrderIntakeLine } from '@/lib/inventory/order-intake';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/webhooks/zoho/orders
 *
 * Receives a Zoho Inventory / Zoho Books order-created webhook and
 * routes it through src/lib/inventory/order-intake.ts to ensure orders
 * rows exist + auto-allocate when INVENTORY_V2_ALLOCATION is on.
 *
 * Auth:
 *   - The request MUST carry the header
 *       x-zoho-webhook-secret: $ZOHO_WEBHOOK_SECRET
 *     (configured on the Zoho side). Returns 401 if missing/mismatched.
 *   - If ZOHO_WEBHOOK_SECRET is unset in the environment, the route
 *     returns 503 — failing closed by default rather than open.
 *
 * Payload shape (best-effort; Zoho's exact wire format varies between
 * Inventory and Books and across event subtypes — adjust the
 * extractZohoOrder() helper below as needed):
 *
 *   {
 *     "salesorder": {
 *       "salesorder_id": "1234567890",
 *       "salesorder_number": "SO-00042",
 *       "date": "2026-05-18",
 *       "customer_id": "9876543210",
 *       "line_items": [
 *         { "sku": "IPH13-128-BLU", "quantity": 1, "name": "iPhone 13 128 Blue" }
 *       ]
 *     }
 *   }
 *
 * Idempotency: the ingest helper upserts orders by (order_id, sku) and
 * uses a deterministic clientEventId for allocation events, so Zoho's
 * normal retry behavior is safe.
 */

interface ZohoLineItem {
  sku?: string;
  quantity?: number;
  name?: string;
  item_name?: string;
  description?: string;
}

interface ZohoSalesOrder {
  salesorder_id?: string;
  sales_order_id?: string;  // some payloads use snake-case
  salesorder_number?: string;
  date?: string;
  customer_id?: string;
  line_items?: ZohoLineItem[];
  items?: ZohoLineItem[];   // alternate key
}

interface NormalizedZohoOrder {
  externalId: string;
  customerExternalId: string | null;
  orderDate: string | null;
  lineItems: OrderIntakeLine[];
}

/**
 * Pull a NormalizedZohoOrder out of an incoming webhook payload.
 * Tolerates the two main shapes Zoho sends (wrapped under `salesorder`
 * or as a top-level object) and falls back gracefully on missing
 * fields. Returns null when the payload doesn't look like an order
 * (e.g. ping events, malformed bodies).
 */
function extractZohoOrder(body: unknown): NormalizedZohoOrder | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;

  const so =
    (root.salesorder as ZohoSalesOrder | undefined) ??
    (root.sales_order as ZohoSalesOrder | undefined) ??
    (root as ZohoSalesOrder);

  const externalId = String(so?.salesorder_id ?? so?.sales_order_id ?? '').trim();
  if (!externalId) return null;

  const rawLines = Array.isArray(so?.line_items)
    ? so.line_items
    : Array.isArray(so?.items)
      ? so.items
      : [];
  const lineItems: OrderIntakeLine[] = rawLines
    .map((row) => {
      const sku = String(row?.sku ?? '').trim();
      if (!sku) return null;
      const qty = Number(row?.quantity);
      return {
        sku,
        quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
        productTitle: (row?.name ?? row?.item_name ?? row?.description ?? '')?.toString().trim() || undefined,
      } as OrderIntakeLine;
    })
    .filter((l): l is OrderIntakeLine => l !== null);

  return {
    externalId,
    customerExternalId: so?.customer_id?.toString().trim() || null,
    orderDate: so?.date?.toString().trim() || null,
    lineItems,
  };
}

export async function POST(request: NextRequest) {
  // 1. Auth — fail closed when the secret isn't configured.
  const expected = process.env.ZOHO_WEBHOOK_SECRET;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'ZOHO_WEBHOOK_SECRET not configured' },
      { status: 503 },
    );
  }
  const provided = request.headers.get('x-zoho-webhook-secret');
  if (provided !== expected) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse + normalize.
  const body = await request.json().catch(() => null);
  const order = extractZohoOrder(body);
  if (!order) {
    return NextResponse.json(
      { ok: false, error: 'payload did not match expected Zoho salesorder shape' },
      { status: 400 },
    );
  }
  if (order.lineItems.length === 0) {
    return NextResponse.json(
      { ok: true, externalId: order.externalId, lines: [], totalLines: 0, unitsAllocated: 0, note: 'no line items with SKUs' },
    );
  }

  // 3. Ingest.
  try {
    const result = await ingestOrder({
      externalId: order.externalId,
      source: 'zoho',
      customerExternalId: order.customerExternalId,
      orderDate: order.orderDate,
      lineItems: order.lineItems,
      actorStaffId: null,
    });
    return NextResponse.json({
      ok: true,
      externalId: result.externalId,
      source: result.source,
      totalLines: result.totalLines,
      unitsAllocated: result.unitsAllocated,
      lines: result.lines.map((l) => ({
        sku: l.sku,
        order_id: l.orderId,
        created: l.created,
        allocation: l.allocation
          ? l.allocation.ok
            ? { ok: true, allocated: l.allocation.allocated, partial: l.allocation.partial }
            : { ok: false, status: l.allocation.status, error: l.allocation.error }
          : null,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'order ingest failed';
    console.error('[POST /api/webhooks/zoho/orders] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** Health probe. Useful for Zoho's "Test" button. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    webhook: 'zoho.orders',
    configured: !!process.env.ZOHO_WEBHOOK_SECRET,
  });
}
