import { NextRequest, NextResponse } from 'next/server';
import {
  createPurchaseReceive,
  getPurchaseOrderById,
  mergeCatalogItemIdsFromPurchaseOrder,
  type ZohoPurchaseReceiveLine,
} from '@/lib/zoho';

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
 *   receive_number: "optional — generated if omitted",
 *   line_items: [{ line_item_id: "...", quantity or quantity_received: 1, item_id?: "..." }]
 *   (createPurchaseReceive maps counts to Zoho's `quantity` field on the wire.)
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

    const zohoBillId = String(body?.zoho_bill_id ?? '').trim() || undefined;
    const zohoBillNumber = String(body?.zoho_bill_number ?? '').trim() || undefined;

    const poBefore = await getPurchaseOrderById(purchaseOrderId).catch((e) => ({ error: String(e) }));

    const normalizedLines =
      lineItems.length > 0
        ? lineItems.map((l: Record<string, unknown>) => ({
            line_item_id: String(l.line_item_id || ''),
            quantity_received: Number(l.quantity_received || l.quantity || 0),
            item_id: String(l.item_id || '').trim(),
          }))
        : [];

    const mergedLines =
      poBefore &&
      typeof poBefore === 'object' &&
      'purchaseorder' in poBefore &&
      (poBefore as { purchaseorder?: unknown }).purchaseorder
        ? mergeCatalogItemIdsFromPurchaseOrder(
            poBefore as { purchaseorder?: { line_items?: unknown[] } },
            normalizedLines,
          )
        : normalizedLines;

    let response: unknown;
    let zohoError: unknown = null;
    try {
      response = await createPurchaseReceive({
        purchaseOrderId,
        lineItems: mergedLines,
        ...(zohoBillId ? { billId: zohoBillId } : {}),
        ...(zohoBillNumber ? { billNumberHint: zohoBillNumber } : {}),
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
        note: 'receive_number is auto-generated in createPurchaseReceive when omitted',
        lineItems: mergedLines.map((l: ZohoPurchaseReceiveLine) => ({
          line_item_id: l.line_item_id,
          quantity_received: l.quantity_received,
          item_id: l.item_id,
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
