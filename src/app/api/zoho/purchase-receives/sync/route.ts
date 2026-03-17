import { NextRequest, NextResponse } from 'next/server';
import { listPurchaseOrders } from '@/lib/zoho';
import { importZohoPurchaseOrderToReceiving } from '@/lib/zoho-receiving-sync';
import { enqueueQStashJson, getQStashResultIdentifier } from '@/lib/qstash';

export const dynamic = 'force-dynamic';

function normalizeId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

async function runZohoPurchaseReceivesSync(body: Record<string, unknown> = {}) {
  const perPageRaw = Number(body?.per_page ?? 100);
  const perPage = Number.isFinite(perPageRaw) && perPageRaw > 0 ? Math.min(200, Math.floor(perPageRaw)) : 100;
  const maxPagesRaw = Number(body?.max_pages ?? 5);
  const maxPages = Number.isFinite(maxPagesRaw) && maxPagesRaw > 0 ? Math.min(20, Math.floor(maxPagesRaw)) : 5;
  const maxItemsRaw = Number(body?.max_items ?? 500);
  const maxItems = Number.isFinite(maxItemsRaw) && maxItemsRaw > 0 ? Math.min(2000, Math.floor(maxItemsRaw)) : 500;

  const statusFilter = String(body?.status || '').trim() || undefined;

  let processed = 0;
  let synced = 0;
  let failed = 0;
  let totalLineItems = 0;
  const errors: Array<{ purchaseorder_id: string; error: string }> = [];

  for (let page = 1; page <= maxPages && processed < maxItems; page++) {
    let data;
    try {
      data = await listPurchaseOrders({
        page,
        per_page: perPage,
        ...(statusFilter ? { status: statusFilter } : {}),
      });
    } catch (err: unknown) {
      const cause = (err as any)?.cause;
      const causeMsg = cause?.code || cause?.message || '';
      const msg = err instanceof Error ? err.message : String(err);
      const fullMsg = causeMsg ? `${msg} (${causeMsg})` : msg;
      throw new Error(`Failed to list Zoho purchase orders: ${fullMsg}`);
    }

    const rows = (data as Record<string, unknown>)?.purchaseorders;
    const orders = Array.isArray(rows) ? rows : [];
    if (orders.length === 0) break;

    for (const order of orders) {
      if (processed >= maxItems) break;
      processed++;

      const orderRow = order as Record<string, unknown>;
      const purchaseOrderId =
        normalizeId(orderRow.purchaseorder_id) ||
        normalizeId(orderRow.id);

      if (!purchaseOrderId) {
        failed++;
        errors.push({ purchaseorder_id: 'unknown', error: 'Missing purchase order ID' });
        continue;
      }

      try {
        const result = await importZohoPurchaseOrderToReceiving(purchaseOrderId);
        synced++;
        totalLineItems += result.line_items_synced;
      } catch (error: unknown) {
        failed++;
        const msg = error instanceof Error ? error.message : 'Import failed';
        console.error(`[zoho-sync] Failed to sync PO ${purchaseOrderId}:`, msg);
        errors.push({ purchaseorder_id: purchaseOrderId, error: msg });
      }
    }

    const hasMore = Boolean((data as any)?.page_context?.has_more_page);
    if (!hasMore) break;
  }

  return {
    success: true,
    message: 'Zoho purchase orders synced to receiving_lines.',
    status_filter: statusFilter || 'all',
    totals: {
      pos_processed: processed,
      pos_synced: synced,
      pos_failed: failed,
      line_items_synced: totalLineItems,
    },
    errors: errors.slice(0, 25),
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body?.enqueue === true) {
      const result = await enqueueQStashJson({
        path: '/api/zoho/purchase-receives/sync',
        body: { ...body, enqueue: false },
        retries: 3,
        timeout: 300,
        label: 'zoho-purchase-receives-sync',
      });
      return NextResponse.json({
        success: true,
        queued: true,
        messageId: getQStashResultIdentifier(result),
      });
    }
    return NextResponse.json(await runZohoPurchaseReceivesSync(body));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to sync Zoho purchase orders';
    console.error('[zoho-sync] Unexpected error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
