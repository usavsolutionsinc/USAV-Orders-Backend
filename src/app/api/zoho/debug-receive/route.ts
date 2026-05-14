import { NextRequest, NextResponse } from 'next/server';
import { createPurchaseReceive, getPurchaseOrderById } from '@/lib/zoho';

export const dynamic = 'force-dynamic';

/**
 * Debug-only synchronous wrapper around createPurchaseReceive. POST the same
 * body shape the after() block in mark-received-po would generate. The Zoho
 * response (or the raw error) is returned verbatim so we can see exactly what
 * Zoho is saying.
 *
 * Body:
 * {
 *   purchaseorder_id: "5623409000002250332",
 *   line_items: [{ line_item_id: "...", quantity_received: 1 }]
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const purchaseOrderId = String(body?.purchaseorder_id || '').trim();
    const lineItems = Array.isArray(body?.line_items) ? body.line_items : [];
    if (!purchaseOrderId || lineItems.length === 0) {
      return NextResponse.json({ ok: false, error: 'purchaseorder_id and line_items required' }, { status: 400 });
    }

    const poBefore = await getPurchaseOrderById(purchaseOrderId).catch((e) => ({ error: String(e) }));

    let response: unknown;
    let zohoError: unknown = null;
    try {
      response = await createPurchaseReceive({
        purchaseOrderId,
        lineItems: lineItems.map((l: Record<string, unknown>) => ({
          line_item_id: String(l.line_item_id || ''),
          quantity_received: Number(l.quantity_received || 0),
        })),
      });
    } catch (err) {
      zohoError = err instanceof Error
        ? { message: err.message, stack: err.stack, name: err.name }
        : err;
    }

    const poAfter = await getPurchaseOrderById(purchaseOrderId).catch((e) => ({ error: String(e) }));

    return NextResponse.json({
      ok: !zohoError,
      requestSent: {
        purchaseOrderId,
        lineItems: lineItems.map((l: Record<string, unknown>) => ({
          line_item_id: String(l.line_item_id || ''),
          quantity: Number(l.quantity_received || 0),
        })),
      },
      zohoResponse: response ?? null,
      zohoError,
      poBefore: (poBefore as { purchaseorder?: { status?: string; received_status?: string; line_items?: unknown[] } })
        ?.purchaseorder
        ? {
            status: (poBefore as { purchaseorder: { status?: string } }).purchaseorder.status,
            received_status: (poBefore as { purchaseorder: { received_status?: string } }).purchaseorder.received_status,
            line_items: (poBefore as { purchaseorder: { line_items?: unknown[] } }).purchaseorder.line_items,
          }
        : poBefore,
      poAfter: (poAfter as { purchaseorder?: { status?: string; received_status?: string; line_items?: unknown[] } })
        ?.purchaseorder
        ? {
            status: (poAfter as { purchaseorder: { status?: string } }).purchaseorder.status,
            received_status: (poAfter as { purchaseorder: { received_status?: string } }).purchaseorder.received_status,
            line_items: (poAfter as { purchaseorder: { line_items?: unknown[] } }).purchaseorder.line_items,
          }
        : poAfter,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
