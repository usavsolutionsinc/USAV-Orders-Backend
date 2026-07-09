import { NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';
import { isFulfillmentSubstitution } from '@/lib/feature-flags';
import type { AmendmentTimelineRow } from '@/lib/timeline';
import type { OrgId } from '@/lib/tenancy/constants';

/**
 * GET /api/orders/[id]/amendments
 *
 * The order's fulfillment substitutions (ordered-vs-fulfilled deviations),
 * newest first. Shaped so the client can drop the rows straight into
 * amendmentsToTimeline() for the shared EventTimeline, or render the pending-
 * approval queue. Read-only; the write paths are POST /substitute + the
 * /order-amendments/[id]/decision route.
 *
 * Returns an empty list (not an error) when the feature is disabled so a
 * consuming card can call it unconditionally and degrade cleanly.
 *
 * Permission: orders.view.
 */
export const GET = withAuth(async (request, ctx) => {
  if (!isFulfillmentSubstitution()) {
    return NextResponse.json({ ok: true, amendments: [] });
  }

  const orgId = ctx.organizationId as OrgId;

  // [id] segment: /api/orders/{id}/amendments → second-to-last.
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const orderId = Number(segments[segments.length - 2]);
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid order id' }, { status: 400 });
  }

  const rows = await tenantQuery<AmendmentTimelineRow & { raised_at_node: string | null }>(
    orgId,
    `SELECT a.id,
            a.created_at::text                  AS created_at,
            a.status,
            a.reason_code,
            a.customer_request_note,
            a.original_sku,
            a.original_condition,
            a.fulfilled_sku,
            a.fulfilled_condition,
            a.substitute_unit_id,
            su.serial_number                    AS substitute_serial,
            a.raised_at_node,
            s.name                              AS raised_by_name
       FROM order_unit_amendments a
       LEFT JOIN serial_units su ON su.id = a.substitute_unit_id
                                AND su.organization_id = a.organization_id
       LEFT JOIN staff       s  ON s.id = a.raised_by
                                AND s.organization_id = a.organization_id
      WHERE a.order_id = $1
        AND a.organization_id = $2
      ORDER BY a.created_at DESC, a.id DESC`,
    [orderId, orgId],
  );

  return NextResponse.json({ ok: true, amendments: rows.rows });
}, { permission: 'orders.view' });
