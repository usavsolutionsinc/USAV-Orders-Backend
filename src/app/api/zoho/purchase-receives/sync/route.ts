import { NextRequest, NextResponse } from 'next/server';
import { listPurchaseReceives } from '@/lib/zoho';
import { importZohoPurchaseReceiveToReceiving } from '@/lib/zoho-receiving-sync';

export const dynamic = 'force-dynamic';

/** Format a Date for Zoho API params: YYYY-MM-DDTHH:MM:SS+0000 (no ms, explicit UTC offset) */
function toZohoDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '+0000');
}

function normalizeId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    const perPageRaw = Number(body?.per_page ?? 100);
    const perPage = Number.isFinite(perPageRaw) && perPageRaw > 0 ? Math.min(200, Math.floor(perPageRaw)) : 100;
    const maxPagesRaw = Number(body?.max_pages ?? 3);
    const maxPages = Number.isFinite(maxPagesRaw) && maxPagesRaw > 0 ? Math.min(20, Math.floor(maxPagesRaw)) : 3;
    const maxItemsRaw = Number(body?.max_items ?? 300);
    const maxItems = Number.isFinite(maxItemsRaw) && maxItemsRaw > 0 ? Math.min(2000, Math.floor(maxItemsRaw)) : 300;

    const daysBackRaw = Number(body?.days_back ?? 30);
    const daysBack = Number.isFinite(daysBackRaw) && daysBackRaw > 0 ? Math.min(365, Math.floor(daysBackRaw)) : 30;
    const lastModifiedTime =
      String(body?.last_modified_time || '').trim() ||
      toZohoDate(new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000));

    const receivedBy = Number(body?.received_by);
    const assignedTechId = Number(body?.assigned_tech_id);
    const needsTest = !!body?.needs_test;
    const targetChannel = String(body?.target_channel || '').trim().toUpperCase() || null;

    let processed = 0;
    let imported = 0;
    let created = 0;
    let updated = 0;
    let failed = 0;
    const errors: Array<{ purchase_receive_id: string; error: string }> = [];

    for (let page = 1; page <= maxPages && processed < maxItems; page++) {
      const data = await listPurchaseReceives({
        page,
        per_page: perPage,
        last_modified_time: lastModifiedTime,
      });

      const rows = (data as Record<string, unknown>)?.purchasereceives;
      const receives = Array.isArray(rows) ? rows : [];
      if (receives.length === 0) break;

      for (const receive of receives) {
        if (processed >= maxItems) break;
        processed++;

        const receiveRow = receive as Record<string, unknown>;
        const purchaseReceiveId =
          normalizeId(receiveRow.purchase_receive_id) ||
          normalizeId(receiveRow.receive_id) ||
          normalizeId(receiveRow.id);

        if (!purchaseReceiveId) {
          failed++;
          errors.push({ purchase_receive_id: 'unknown', error: 'Missing purchase receive ID' });
          continue;
        }

        try {
          const result = await importZohoPurchaseReceiveToReceiving({
            purchaseReceiveId,
            receivedBy: Number.isFinite(receivedBy) && receivedBy > 0 ? Math.floor(receivedBy) : null,
            assignedTechId: Number.isFinite(assignedTechId) && assignedTechId > 0 ? Math.floor(assignedTechId) : null,
            needsTest,
            targetChannel,
          });
          imported++;
          if (result.mode === 'created') created++;
          if (result.mode === 'updated') updated++;
        } catch (error: unknown) {
          failed++;
          errors.push({
            purchase_receive_id: purchaseReceiveId,
            error: error instanceof Error ? error.message : 'Import failed',
          });
        }
      }

      const hasMore = Boolean((data as any)?.page_context?.has_more_page);
      if (!hasMore) break;
    }

    return NextResponse.json({
      success: true,
      message: 'Zoho purchase receives sync completed.',
      last_modified_time: lastModifiedTime,
      per_page: perPage,
      max_pages: maxPages,
      max_items: maxItems,
      totals: {
        processed,
        imported,
        created,
        updated,
        failed,
      },
      errors: errors.slice(0, 25),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to sync Zoho purchase receives';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
