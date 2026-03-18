import { NextRequest, NextResponse } from 'next/server';
import { syncZohoPurchaseOrdersToReceiving } from '@/lib/zoho-receiving-sync';
import { enqueueQStashJson, getQStashResultIdentifier } from '@/lib/qstash';

export const dynamic = 'force-dynamic';

async function runZohoPurchaseReceivesSync(body: Record<string, unknown> = {}) {
  const daysBackRaw = Number(body?.days_back ?? 0);
  const daysBack = Number.isFinite(daysBackRaw) && daysBackRaw >= 0 ? daysBackRaw : 0;
  const statusFilter = String(body?.status || '').trim() || undefined;
  const summary = await syncZohoPurchaseOrdersToReceiving({
    status: statusFilter,
    days_back: daysBack,
    per_page: Number(body?.per_page) || 100,
    max_pages: Number(body?.max_pages) || 5,
    max_items: Number(body?.max_items) || 500,
  });

  return {
    success: true,
    message: 'Zoho purchase orders synced to receiving_lines via the canonical inbound sync service.',
    status_filter: statusFilter || 'all',
    totals: {
      pos_processed: summary.processed,
      pos_synced: summary.created + summary.updated,
      pos_failed: summary.failed,
      line_items_synced: summary.line_items_synced,
    },
    errors: summary.errors.slice(0, 25),
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
