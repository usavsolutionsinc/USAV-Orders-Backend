/**
 * POST /api/zoho/purchase-orders/sync
 *
 * Bulk-imports all Zoho purchase orders into the local receiving / receiving_lines tables.
 * Each PO → one receiving row (carrier = ZOHO_PO, qa_status = PENDING).
 * Each PO line item → one receiving_lines row.
 * Re-running is safe: existing rows are updated by zoho_purchaseorder_id.
 *
 * Aligns with Zoho Inventory API v1:
 *   GET /api/v1/purchaseorders          — list with filters + pagination
 *   GET /api/v1/purchaseorders/{id}     — detail (line_items)
 *
 * Body (all optional):
 * {
 *   "status":             "open" | "draft" | "billed" | "cancelled" | "issued",
 *   "vendor_id":          "<zoho vendor id>",
 *   "last_modified_time": "2025-01-01T00:00:00Z",
 *   "days_back":          90,    // used when last_modified_time absent; 0 = all time
 *   "per_page":           200,
 *   "max_pages":          50,
 *   "max_items":          5000
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { syncZohoPurchaseOrdersToReceiving } from '@/lib/zoho-po-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const daysBackRaw = Number(body?.days_back ?? 0);
    const daysBack = Number.isFinite(daysBackRaw) && daysBackRaw >= 0 ? daysBackRaw : 0;

    const summary = await syncZohoPurchaseOrdersToReceiving({
      status: String(body?.status || '').trim() || undefined,
      vendor_id: String(body?.vendor_id || '').trim() || undefined,
      last_modified_time: String(body?.last_modified_time || '').trim() || undefined,
      days_back: daysBack,
      per_page: Number(body?.per_page) || 200,
      max_pages: Number(body?.max_pages) || 50,
      max_items: Number(body?.max_items) || 5000,
    });

    return NextResponse.json({
      success: true,
      message: 'Zoho purchase orders sync completed.',
      totals: {
        processed: summary.processed,
        created: summary.created,
        updated: summary.updated,
        failed: summary.failed,
      },
      errors: summary.errors.slice(0, 25),
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Failed to sync Zoho purchase orders';
    console.error('[purchase-orders/sync] Error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
