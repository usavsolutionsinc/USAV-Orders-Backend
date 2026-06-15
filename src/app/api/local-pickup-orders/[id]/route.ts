import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { tenantQuery } from '@/lib/tenancy/db';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRoutePerm(req, 'walk_in.view');
  if (gate.denied) return gate.denied;
  const orgId = gate.ctx.organizationId;
  try {
    const { id } = await params;
    const orderId = Number(id);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid order ID' }, { status: 400 });
    }

    const orderResult = await tenantQuery(
      orgId,
      `SELECT o.*, s.name AS created_by_name, vs.name AS voided_by_name
       FROM local_pickup_orders o
       LEFT JOIN staff s ON s.id = o.created_by
       LEFT JOIN staff vs ON vs.id = o.voided_by
       WHERE o.id = $1 AND o.organization_id = $2`,
      [orderId, orgId],
    );
    if (orderResult.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    // Titles come from the canonical Zoho `sku_catalog` (not Ecwid display_name)
    // so the review/reprint panel matches the pickup product search. The
    // sku_catalog join is on the SKU string (collides across tenants) so it is
    // org-aligned to the line's own org.
    const itemsResult = await tenantQuery(
      orgId,
      `SELECT oi.*,
         COALESCE(sc.product_title, oi.product_title) AS display_name,
         COALESCE(sc.image_url, oi.image_url) AS resolved_image_url
       FROM local_pickup_order_items oi
       LEFT JOIN sku_catalog sc ON sc.sku = oi.sku AND sc.organization_id = oi.organization_id
       WHERE oi.order_id = $1 AND oi.organization_id = $2
       ORDER BY oi.id ASC`,
      [orderId, orgId],
    );

    return NextResponse.json({
      success: true,
      order: {
        ...orderResult.rows[0],
        pickup_date: String(orderResult.rows[0].pickup_date),
        items: itemsResult.rows,
      },
    });
  } catch (error: any) {
    console.error('[local-pickup-orders][GET/:id]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch order' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRoutePerm(req, 'walk_in.intake');
  if (gate.denied) return gate.denied;
  const orgId = gate.ctx.organizationId;
  try {
    const { id } = await params;
    const orderId = Number(id);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid order ID' }, { status: 400 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];

    if ('customer_name' in body || 'customerName' in body) {
      values.push(String(body.customer_name ?? body.customerName ?? '').trim() || null);
      setClauses.push(`customer_name = $${values.length}`);
    }
    if ('pickup_date' in body || 'pickupDate' in body) {
      values.push(String(body.pickup_date ?? body.pickupDate ?? ''));
      setClauses.push(`pickup_date = $${values.length}::date`);
    }
    if ('notes' in body) {
      values.push(String(body.notes ?? '').trim() || null);
      setClauses.push(`notes = $${values.length}`);
    }

    values.push(orderId);
    const idIdx = values.length;
    values.push(orgId);
    const orgIdx = values.length;

    const result = await tenantQuery(
      orgId,
      `UPDATE local_pickup_orders SET ${setClauses.join(', ')} WHERE id = $${idIdx} AND organization_id = $${orgIdx} AND status = 'DRAFT' RETURNING *`,
      values,
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Order not found or not in DRAFT status' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, order: result.rows[0] });
  } catch (error: any) {
    console.error('[local-pickup-orders][PATCH/:id]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to update order' },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRoutePerm(req, 'walk_in.intake');
  if (gate.denied) return gate.denied;
  const orgId = gate.ctx.organizationId;
  try {
    const { id } = await params;
    const orderId = Number(id);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid order ID' }, { status: 400 });
    }

    const result = await tenantQuery(
      orgId,
      `DELETE FROM local_pickup_orders WHERE id = $1 AND organization_id = $2 AND status = 'DRAFT' RETURNING id`,
      [orderId, orgId],
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Order not found or not in DRAFT status' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, deleted: true });
  } catch (error: any) {
    console.error('[local-pickup-orders][DELETE/:id]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to delete order' },
      { status: 500 },
    );
  }
}
