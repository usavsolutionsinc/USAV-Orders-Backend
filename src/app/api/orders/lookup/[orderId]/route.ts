import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';

/**
 * GET /api/orders/lookup/:orderId
 *
 * Look up a single order by its string `order_id` (the externally-visible
 * order number, NOT the numeric primary key). Returns the order joined with
 * customer + current work assignment + serial numbers so the mobile detail
 * page at /m/orders/[orderId] can render in one shot.
 *
 * Read-only. Does not write to receiving or any other table.
 */

export const dynamic = 'force-dynamic';

interface OrderDetail {
  id: number;
  order_id: string;
  product_title: string | null;
  sku: string | null;
  condition: string | null;
  status: string | null;
  status_history: unknown;
  quantity: string | null;
  notes: string | null;
  account_source: string | null;
  order_date: string | null;
  created_at: string | null;
  item_number: string | null;
  shipment_id: number | null;
  customer_id: number | null;
  customer_name: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_postal_code: string | null;
  ship_to_address_1: string | null;
  ship_by_date: string | null;
  tester_id: number | null;
  packer_id: number | null;
  tracking_numbers: string[];
  serials: string[];
}

export const GET = withAuth(async (request: NextRequest, ctx) => {
  const orgId = ctx.organizationId;
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const orderId = segments[segments.length - 1];
  if (!orderId) {
    return NextResponse.json({ ok: false, error: 'invalid order id' }, { status: 400 });
  }
  const decoded = decodeURIComponent(orderId);

  // order_id is a per-tenant string key — anchor the read on the org so a
  // collision across tenants can't surface another org's order.
  const orderResult = await tenantQuery<OrderDetail>(
    orgId,
    `
    SELECT
      o.id,
      o.order_id,
      o.product_title,
      o.sku,
      o.condition,
      o.status,
      o.status_history,
      o.quantity,
      o.notes,
      o.account_source,
      o.order_date,
      o.created_at,
      o.item_number,
      o.shipment_id,
      o.customer_id,
      COALESCE(c.display_name, c.customer_name) AS customer_name,
      c.shipping_address->>'city' AS ship_to_city,
      c.shipping_address->>'state' AS ship_to_state,
      c.shipping_address->>'postal_code' AS ship_to_postal_code,
      c.shipping_address->>'address_1' AS ship_to_address_1,
      wa_test.deadline_at AS ship_by_date,
      wa_test.assigned_tech_id AS tester_id,
      wa_pack.assigned_packer_id AS packer_id,
      COALESCE(
        (
          SELECT array_agg(DISTINCT stn.tracking_number_raw)
          FROM shipping_tracking_numbers stn
          WHERE stn.id = o.shipment_id AND stn.tracking_number_raw IS NOT NULL
        ),
        ARRAY[]::text[]
      ) AS tracking_numbers,
      COALESCE(
        (
          SELECT array_agg(DISTINCT tsn.serial_number ORDER BY tsn.serial_number)
          FROM tech_serial_numbers tsn
          WHERE tsn.shipment_id = o.shipment_id AND tsn.serial_number IS NOT NULL
            AND tsn.organization_id = o.organization_id
        ),
        ARRAY[]::text[]
      ) AS serials
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id AND c.organization_id = o.organization_id
    LEFT JOIN LATERAL (
      SELECT deadline_at, assigned_tech_id
      FROM work_assignments
      WHERE entity_type = 'ORDER' AND entity_id = o.id AND work_type = 'TEST'
        AND organization_id = o.organization_id
      ORDER BY assigned_at DESC NULLS LAST
      LIMIT 1
    ) wa_test ON true
    LEFT JOIN LATERAL (
      SELECT assigned_packer_id
      FROM work_assignments
      WHERE entity_type = 'ORDER' AND entity_id = o.id AND work_type = 'PACK'
        AND organization_id = o.organization_id
      ORDER BY assigned_at DESC NULLS LAST
      LIMIT 1
    ) wa_pack ON true
    WHERE o.order_id = $1
      AND o.organization_id = $2
    LIMIT 1
  `,
    [decoded, orgId],
  );
  const order = orderResult.rows[0] ?? null;

  if (!order) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  // Recent activity for the activity strip — last 5 work_assignment status
  // transitions on this order.
  const activityResult = await tenantQuery<{
    event_at: string;
    work_type: string;
    status: string;
    actor_id: number | null;
    actor_name: string | null;
  }>(
    orgId,
    `
    SELECT
      wa.updated_at AS event_at,
      wa.work_type,
      wa.status,
      COALESCE(wa.assigned_tech_id, wa.assigned_packer_id) AS actor_id,
      s.name AS actor_name
    FROM work_assignments wa
    LEFT JOIN staff s ON s.id = COALESCE(wa.assigned_tech_id, wa.assigned_packer_id) AND s.organization_id = wa.organization_id
    WHERE wa.entity_type = 'ORDER' AND wa.entity_id = $1
      AND wa.organization_id = $2
    ORDER BY wa.updated_at DESC NULLS LAST
    LIMIT 5
  `,
    [order.id, orgId],
  );
  const activity = activityResult.rows;

  return NextResponse.json({ ok: true, order, activity });
}, { permission: 'sku_stock.view' });
