/**
 * POST /api/receiving/inbound/import-ebay
 *
 * Universal Incoming — Phase 2 Track B (bridge import). Manually land an eBay
 * buyer-account purchase onto the Incoming spine BEFORE (or without) the eBay Buy
 * Order API sync, using the SAME UPSERT the Phase 3 API sync will use
 * (src/lib/inbound/ingest-purchase.ts). The row shows in `/receiving?mode=incoming`
 * with the eBay source badge + the buyer account chip.
 * Plan: docs/incoming-universal-purchase-orders-plan.md §5.1, §5.2.
 *
 * Skeleton: withAuth(permission) → validate → ingestPurchase() domain helper →
 * map 200/400 → recordAudit → after() cache refresh.
 */

import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { ingestPurchase } from '@/lib/inbound/ingest-purchase';

export const POST = withAuth(async (request: NextRequest, ctx) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const str = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);

  // The external eBay order id — the identity this row dedups on.
  const sourceOrderId = str(body.order_id ?? body.source_order_id);
  if (!sourceOrderId) {
    return NextResponse.json(
      { success: false, error: 'order_id (the eBay order number) is required' },
      { status: 400 },
    );
  }

  const sku = str(body.sku);
  const itemName = str(body.item_name);
  if (!sku && !itemName) {
    return NextResponse.json(
      { success: false, error: 'must provide at least one of: sku, item_name' },
      { status: 400 },
    );
  }

  const quantityRaw = body.quantity ?? body.quantity_expected;
  const quantity = quantityRaw == null ? 1 : Number(quantityRaw);
  if (!Number.isFinite(quantity) || quantity < 1) {
    return NextResponse.json(
      { success: false, error: 'quantity must be an integer >= 1' },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await ingestPurchase(ctx.organizationId, {
      sourceType: 'ebay',
      sourceOrderId,
      sourceLineItemId: str(body.line_item_id),
      accountLabel: str(body.account_name ?? body.account_label),
      sku,
      itemName,
      quantityExpected: quantity,
      conditionGrade: str(body.condition_grade) ?? undefined,
      // eBay purchase facts
      legacyOrderId: str(body.legacy_order_id),
      sellerUsername: str(body.seller ?? body.seller_username),
      purchaseOrderStatus: str(body.status),
      paymentStatus: str(body.payment_status),
      listingUrl: str(body.listing_url),
      // mirror snapshot
      orderNumber: str(body.order_number) ?? sourceOrderId,
      vendorOrSellerName: str(body.seller ?? body.seller_username),
      trackingNumber: str(body.tracking_number),
      carrierCode: str(body.carrier_code),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'import failed';
    // Unregistered source / blank order id are client errors; anything else is 500.
    const status = /required|unregistered/.test(message) ? 400 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }

  await recordAudit(pool, ctx, request, {
    source: 'inbound-import-ebay',
    action: AUDIT_ACTION.RECEIVING_INBOUND_IMPORT,
    entityType: AUDIT_ENTITY.RECEIVING_LINE,
    entityId: result.receivingLineId,
    method: 'manual',
    after: {
      sourceType: result.sourceType,
      sourceOrderId: result.sourceOrderId,
      platformAccountId: result.platformAccountId,
      created: result.created,
    },
  });

  after(async () => {
    try {
      await invalidateCacheTags(['receiving-lines', 'receiving-logs']);
    } catch (e) {
      console.warn('[inbound/import-ebay] cache invalidation failed', e);
    }
  });

  return NextResponse.json(
    {
      success: true,
      receiving_line_id: result.receivingLineId,
      created: result.created,
      platform_account_id: result.platformAccountId,
    },
    { status: result.created ? 201 : 200 },
  );
}, { permission: 'integrations.ebay' });
