import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishOrderChanged } from '@/lib/realtime/publish';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

/**
 * POST /api/orders/delete - Delete one or more orders
 * Body: { orderId?: number, orderIds?: number[] }
 *
 * Destructive — requires step-up auth (via orders.void on STEP_UP_PERMISSIONS).
 * Writes a rich audit row per deleted order with full before-state.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await req.json();
    const { orderId, orderIds } = body;

    if (!orderId && (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0)) {
      return NextResponse.json(
        { error: 'orderId or orderIds array is required' },
        { status: 400 }
      );
    }

    const requestedIds: number[] = orderId ? [orderId] : orderIds;

    // An order number (order_id) can carry multiple rows in `orders`: accidental
    // same-product dupes (which the dashboard de-dupes to one visible row) AND
    // genuinely different products (shown as separate lines under one expandable
    // order). A delete carries only the visible row's id, so expand it to its
    // same-product siblings — otherwise an accidental dupe reappears after refetch
    // (the delete "doesn't stick"). Scope the expansion to the SAME product
    // identity (sku_catalog_id → sku → normalized title, mirroring the table's
    // dedupeByOrderProduct) so deleting one product never nukes a different line
    // of a multi-product order.
    // Product identity for a row under the given alias, mirroring the table's
    // dedupeByOrderProduct (sku_catalog_id → non-empty sku → normalized title).
    const productKeyExpr = (a: string) => `COALESCE(
        NULLIF('cat:' || ${a}.sku_catalog_id::text, 'cat:'),
        NULLIF('sku:' || lower(trim(${a}.sku)), 'sku:'),
        NULLIF('title:' || lower(regexp_replace(trim(coalesce(${a}.product_title, '')), '\\s+', ' ', 'g')), 'title:')
      )`;
    const expanded = await pool.query(
      `WITH targets AS (
         SELECT t.order_id, ${productKeyExpr('t')} AS pkey
           FROM orders t
          WHERE t.id = ANY($1::int[]) AND t.order_id IS NOT NULL AND t.order_id <> ''
       )
       SELECT o.id, o.order_id, o.product_title, o.sku, o.condition, o.status, o.shipment_id, o.created_at
         FROM orders o
        WHERE o.id = ANY($1::int[])
           OR EXISTS (
                SELECT 1 FROM targets tg
                 WHERE tg.order_id = o.order_id
                   AND tg.pkey IS NOT DISTINCT FROM ${productKeyExpr('o')}
              )`,
      [requestedIds],
    );
    const beforeRows = expanded;
    const idsToDelete: number[] = expanded.rows.map((r) => Number(r.id));

    if (idsToDelete.length === 0) {
      return NextResponse.json(
        { error: 'No matching orders were deleted', deleted: 0 },
        { status: 404 }
      );
    }

    const result = await pool.query(
      `DELETE FROM orders WHERE id = ANY($1::int[])`,
      [idsToDelete]
    );
    if ((result.rowCount || 0) === 0) {
      return NextResponse.json(
        { error: 'No matching orders were deleted', deleted: 0 },
        { status: 404 }
      );
    }

    // Dashboard shipped table is backed by /api/packerlogs cache ("packing-logs"),
    // not only /api/shipped, so delete must invalidate both domains.
    await invalidateCacheTags(['orders', 'shipped', 'packing-logs']);
    await publishOrderChanged({ organizationId: ctx.organizationId, orderIds: idsToDelete, source: 'orders.delete' });

    // One audit row per deleted order, with full before snapshot.
    for (const row of beforeRows.rows) {
      await recordAudit(pool, ctx, req, {
        source: 'orders.delete',
        action: 'orders.delete',
        entityType: AUDIT_ENTITY.ORDER,
        entityId: Number(row.id),
        before: row,
        after: null,
        method: 'manual',
      });
    }

    return NextResponse.json({ success: true, deleted: result.rowCount || 0 });
  } catch (error: any) {
    console.error('Error deleting order(s):', error);
    return NextResponse.json(
      { error: 'Failed to delete order(s)', details: error.message },
      { status: 500 }
    );
  }
}, { permission: 'orders.void' });
