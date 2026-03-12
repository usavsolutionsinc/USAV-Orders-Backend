import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/utils/date';

type Params = Promise<{ id: string; itemId: string }>;

const STATUS_ORDER: Record<string, number> = {
  PLANNED: 0,
  READY_TO_GO: 1,
  LABEL_ASSIGNED: 2,
  SHIPPED: 3,
};

// ── GET /api/fba/shipments/[id]/items/[itemId] ────────────────────────────────
// Returns a single shipment item with staff name joins.
export async function GET(
  _request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const { id, itemId } = await params;
    const shipmentId = Number(id);
    const itemIdNum = Number(itemId);
    if (!Number.isFinite(shipmentId) || !Number.isFinite(itemIdNum)) {
      return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
    }

    const result = await pool.query(
      `SELECT
         fsi.id,
         fsi.shipment_id,
         fsi.fnsku,
         fsi.product_title,
         fsi.asin,
         fsi.sku,
         fsi.expected_qty,
         fsi.actual_qty,
         fsi.status,
         fsi.ready_by_staff_id,
         fsi.verified_by_staff_id,
         fsi.labeled_by_staff_id,
         fsi.shipped_by_staff_id,
         fsi.ready_at,
         fsi.verified_at,
         fsi.labeled_at,
         fsi.shipped_at,
         fsi.created_at,
         fsi.updated_at,
         r.name  AS ready_by_name,
         v.name  AS verified_by_name,
         l.name  AS labeled_by_name,
         sh.name AS shipped_by_name
       FROM fba_shipment_items fsi
       LEFT JOIN staff r  ON r.id  = fsi.ready_by_staff_id
       LEFT JOIN staff v  ON v.id  = fsi.verified_by_staff_id
       LEFT JOIN staff l  ON l.id  = fsi.labeled_by_staff_id
       LEFT JOIN staff sh ON sh.id = fsi.shipped_by_staff_id
       WHERE fsi.id = $1 AND fsi.shipment_id = $2`,
      [itemIdNum, shipmentId]
    );

    if (!result.rows[0]) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, item: result.rows[0] });
  } catch (error: any) {
    console.error('[GET /api/fba/shipments/[id]/items/[itemId]]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch item' },
      { status: 500 }
    );
  }
}

// ── PATCH /api/fba/shipments/[id]/items/[itemId] ─────────────────────────────
// Update mutable item fields.
// Body (all optional): { expected_qty, status, product_title, asin, sku,
//                        notes, staff_id }
// Guards against backward status transitions.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Params }
) {
  const client = await pool.connect();
  try {
    const { id, itemId } = await params;
    const shipmentId = Number(id);
    const itemIdNum = Number(itemId);
    if (!Number.isFinite(shipmentId) || !Number.isFinite(itemIdNum)) {
      return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
    }

    const body = await request.json();
    const allowedStatuses = Object.keys(STATUS_ORDER);

    if (body.status && !allowedStatuses.includes(body.status)) {
      return NextResponse.json(
        { success: false, error: `status must be one of: ${allowedStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id, status FROM fba_shipment_items WHERE id = $1 AND shipment_id = $2`,
      [itemIdNum, shipmentId]
    );
    if (!existing.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }

    const currentStatus = existing.rows[0].status as string;
    if (body.status) {
      const currentRank = STATUS_ORDER[currentStatus] ?? 0;
      const newRank = STATUS_ORDER[body.status] ?? 0;
      if (newRank < currentRank) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            success: false,
            error: `Cannot move status backward from '${currentStatus}' to '${body.status}'`,
          },
          { status: 409 }
        );
      }
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const setField = (col: string, val: unknown) => {
      fields.push(`${col} = $${idx++}`);
      values.push(val);
    };

    if ('expected_qty' in body) setField('expected_qty', Math.max(0, Number(body.expected_qty) || 0));
    if ('product_title' in body) setField('product_title', body.product_title || null);
    if ('asin' in body) setField('asin', body.asin || null);
    if ('sku' in body) setField('sku', body.sku || null);

    if (body.status) {
      setField('status', body.status);
      // Stamp the corresponding lifecycle timestamp + staff if provided
      const staffId = body.staff_id || null;
      if (body.status === 'READY_TO_GO') {
        setField('ready_by_staff_id', staffId);
        setField('ready_at', formatPSTTimestamp());
      } else if (body.status === 'LABEL_ASSIGNED') {
        setField('labeled_by_staff_id', staffId);
        setField('labeled_at', formatPSTTimestamp());
      } else if (body.status === 'SHIPPED') {
        setField('shipped_by_staff_id', staffId);
        setField('shipped_at', formatPSTTimestamp());
      }
    }

    if (fields.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    fields.push(`updated_at = NOW()`);
    values.push(itemIdNum, shipmentId);

    const result = await client.query(
      `UPDATE fba_shipment_items
       SET ${fields.join(', ')}
       WHERE id = $${idx} AND shipment_id = $${idx + 1}
       RETURNING *`,
      values
    );

    // Re-roll shipment item count cache
    await client.query(
      `UPDATE fba_shipments fs
       SET ready_item_count   = counts.ready_item_count,
           packed_item_count  = counts.packed_item_count,
           shipped_item_count = counts.shipped_item_count,
           updated_at         = NOW()
       FROM (
         SELECT
           shipment_id,
           COUNT(*) FILTER (WHERE status IN ('READY_TO_GO', 'LABEL_ASSIGNED', 'SHIPPED'))::int AS ready_item_count,
           COUNT(*) FILTER (WHERE status IN ('LABEL_ASSIGNED', 'SHIPPED'))::int                AS packed_item_count,
           COUNT(*) FILTER (WHERE status = 'SHIPPED')::int                                    AS shipped_item_count
         FROM fba_shipment_items
         WHERE shipment_id = $1
         GROUP BY shipment_id
       ) counts
       WHERE fs.id = counts.shipment_id`,
      [shipmentId]
    );

    await client.query('COMMIT');

    return NextResponse.json({ success: true, item: result.rows[0] });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[PATCH /api/fba/shipments/[id]/items/[itemId]]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to update item' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

// ── DELETE /api/fba/shipments/[id]/items/[itemId] ─────────────────────────────
// Hard-delete a shipment item. Only allowed when status = 'PLANNED'.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const { id, itemId } = await params;
    const shipmentId = Number(id);
    const itemIdNum = Number(itemId);
    if (!Number.isFinite(shipmentId) || !Number.isFinite(itemIdNum)) {
      return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
    }

    const check = await pool.query(
      `SELECT id, status FROM fba_shipment_items WHERE id = $1 AND shipment_id = $2`,
      [itemIdNum, shipmentId]
    );
    if (!check.rows[0]) {
      return NextResponse.json({ success: false, error: 'Item not found' }, { status: 404 });
    }
    if (check.rows[0].status !== 'PLANNED') {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot delete an item with status '${check.rows[0].status}'. Only PLANNED items can be deleted.`,
        },
        { status: 409 }
      );
    }

    await pool.query(
      `DELETE FROM fba_shipment_items WHERE id = $1 AND shipment_id = $2`,
      [itemIdNum, shipmentId]
    );

    return NextResponse.json({ success: true, deleted_id: itemIdNum });
  } catch (error: any) {
    console.error('[DELETE /api/fba/shipments/[id]/items/[itemId]]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to delete item' },
      { status: 500 }
    );
  }
}
