import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getInvalidFbaPlanIdMessage, parseFbaPlanId } from '@/lib/fba/plan-id';
import { addFnskuToPlan } from '@/domain/fba/condense-fnsku';
import { publishFbaItemChanged, publishFbaShipmentChanged } from '@/lib/realtime/publish';

// â”€â”€ GET /api/fba/shipments/[id]/items â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Returns all items for a specific FBA shipment with staff names joined.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const shipmentId = parseFbaPlanId(id);
    if (shipmentId == null) {
      return NextResponse.json({ success: false, error: getInvalidFbaPlanIdMessage(id) }, { status: 400 });
    }

    const result = await pool.query(
      `SELECT
         fsi.id,
         fsi.fnsku,
         COALESCE(fsi.product_title, ff.product_title, fsi.fnsku) AS display_title,
         fsi.product_title,
         fsi.asin,
         fsi.sku,
         fsi.expected_qty,
         fsi.actual_qty,
         fsi.status,
         fsi.notes,
         fsi.ready_by_staff_id,
         fsi.verified_by_staff_id,
         fsi.labeled_by_staff_id,
         fsi.shipped_by_staff_id,
         fsi.ready_at,
         fsi.verified_at,
         fsi.labeled_at,
         fsi.shipped_at,
         r.name  AS ready_by_name,
         v.name  AS verified_by_name,
         l.name  AS labeled_by_name,
         sh.name AS shipped_by_name
       FROM fba_shipment_items fsi
       LEFT JOIN fba_fnskus ff ON ff.fnsku = fsi.fnsku
       LEFT JOIN staff r  ON r.id  = fsi.ready_by_staff_id
       LEFT JOIN staff v  ON v.id  = fsi.verified_by_staff_id
       LEFT JOIN staff l  ON l.id  = fsi.labeled_by_staff_id
       LEFT JOIN staff sh ON sh.id = fsi.shipped_by_staff_id
       WHERE fsi.shipment_id = $1
       ORDER BY fsi.status DESC, fsi.fnsku`,
      [shipmentId]
    );

    return NextResponse.json({ success: true, items: result.rows });
  } catch (error: any) {
    console.error('[GET /api/fba/shipments/[id]/items]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch items' },
      { status: 500 }
    );
  }
}

// â”€â”€ POST /api/fba/shipments/[id]/items â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Add an FNSKU to a plan with automatic condensing:
//   - If the FNSKU exists in another unshipped plan, it is moved/merged here.
//   - If the FNSKU already exists in this plan, its expected_qty is incremented.
//   - Otherwise a new item row is created.
// Body: { fnsku, expected_qty?, product_title?, asin?, sku?, staff_id? }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = await pool.connect();
  try {
    const { id } = await params;
    const planId = parseFbaPlanId(id);
    if (planId == null) {
      return NextResponse.json({ success: false, error: getInvalidFbaPlanIdMessage(id) }, { status: 400 });
    }

    const body = await request.json();
    const fnsku = String(body?.fnsku || '').trim().toUpperCase();
    if (!fnsku) {
      return NextResponse.json({ success: false, error: 'fnsku is required' }, { status: 400 });
    }

    const expectedQty = Math.max(1, Number(body?.expected_qty) || 1);
    const staffId = body?.staff_id ? Number(body.staff_id) : null;

    await client.query('BEGIN');

    // Verify the target plan exists and is not shipped.
    const planCheck = await client.query(
      `SELECT id, status FROM fba_shipments WHERE id = $1`,
      [planId],
    );
    if (!planCheck.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 });
    }
    if (planCheck.rows[0].status === 'SHIPPED') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { success: false, error: 'Cannot add items to a shipped plan' },
        { status: 409 },
      );
    }

    const result = await addFnskuToPlan(client, {
      targetPlanId: planId,
      fnsku,
      expectedQty,
      staffId,
      productTitle: body?.product_title,
      asin: body?.asin,
      sku: body?.sku,
    });

    await client.query('COMMIT');

    // Fire realtime events so the board refreshes.
    publishFbaItemChanged({
      action: result.action === 'condensed' ? 'reassign' : 'update',
      shipmentId: planId,
      itemId: result.itemId,
      fnsku,
      source: 'api:add-item',
    }).catch(() => {});

    if (result.action === 'condensed' && result.fromPlanId) {
      publishFbaShipmentChanged({
        action: 'updated',
        shipmentId: result.fromPlanId,
        source: 'api:condense-item-removed',
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      item_id: result.itemId,
      action: result.action,
      new_qty: result.newQty,
      from_plan_id: result.fromPlanId ?? null,
    }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[POST /api/fba/shipments/[id]/items]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to add item to plan' },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
