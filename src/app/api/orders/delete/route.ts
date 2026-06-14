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

    const idsToDelete: number[] = orderId ? [orderId] : orderIds;
    const placeholders = idsToDelete.map((_, idx) => `$${idx + 1}`).join(', ');

    // Snapshot rows before delete for the audit trail.
    const beforeRows = await pool.query(
      `SELECT id, order_id, product_title, sku, condition, status, shipment_id, created_at
       FROM orders WHERE id IN (${placeholders})`,
      idsToDelete,
    );

    const result = await pool.query(
      `DELETE FROM orders WHERE id IN (${placeholders})`,
      idsToDelete
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
