/**
 * GET /api/inbox/tech-queue — the tech-station inbox backlog for the logged-in
 * staffer. Two buckets, derived live so the bell survives a reload and shows the
 * true backlog (not just whatever was pushed this session):
 *
 *   - return_pending_test : unboxed returns that still have a line needing test.
 *   - order_ready_ship    : unboxed priority cartons (a pending order needs the
 *                           contents) ready to fulfil/ship.
 *
 * Only primary-TECH staff get contents; everyone else gets an empty queue (the
 * client still subscribes to its own inbox channel — the publishers only fan out
 * to primary techs, so non-techs never receive the refetch events anyway).
 * staffId comes from the verified session; no special permission (own-data read).
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import { isPrimaryTechStaff } from '@/lib/neon/staff-stations-queries';

export const runtime = 'nodejs';

type TechQueueItem = {
  kind: 'return_pending_test' | 'order_ready_ship';
  receivingId: number;
  /** Representative line of the carton — lets the inbox deep-link to the exact row. */
  lineId: number | null;
  trackingNumber: string | null;
  /** Returns: sales order (source_order_id). Orders: matched order, else carton PO#. */
  orderNumber: string | null;
  /** Title SoT = items.name (never the SKU string); falls back to listing item_name / sku. */
  productTitle: string | null;
  unboxedAt: string | null;
};

/**
 * Representative-line LATERAL: one row per carton carrying the line id, the
 * SoT product title (items.name via the zoho_item_id key — never the colliding
 * SKU string), and the line's source order. `$1` = organizationId.
 */
const REP_LINE_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT rl.id AS line_id,
           rl.source_order_id,
           rl.zoho_purchaseorder_number AS line_po,
           COALESCE(zi.name, rl.item_name, rl.sku) AS product_title
      FROM receiving_lines rl
      LEFT JOIN items zi
        ON zi.zoho_item_id = rl.zoho_item_id AND zi.status = 'active'
       AND zi.organization_id = rl.organization_id
     WHERE rl.receiving_id = r.id AND rl.organization_id = $1
     ORDER BY rl.id ASC
     LIMIT 1
  ) rep ON true`;

export const GET = withAuth(async (_req, ctx) => {
  const isTech = await isPrimaryTechStaff(ctx.staffId, ctx.organizationId);
  if (!isTech) {
    return NextResponse.json({
      items: [] as TechQueueItem[],
      counts: { return_pending_test: 0, order_ready_ship: 0 },
    });
  }

  // Unboxed returns that still have at least one line needing test (not yet
  // resolved). The EXISTS clears the bucket once every line reaches a terminal
  // workflow state, so this bucket self-corrects without a manual dismiss.
  const returnsRes = await tenantQuery<{
    receiving_id: number;
    line_id: number | null;
    tracking: string | null;
    order_number: string | null;
    product_title: string | null;
    unboxed_at: string | null;
  }>(
    ctx.organizationId,
    `SELECT r.id AS receiving_id,
            rep.line_id,
            stn.tracking_number_raw AS tracking,
            rep.source_order_id AS order_number,
            rep.product_title,
            r.unboxed_at::text AS unboxed_at
       FROM receiving r
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
       ${REP_LINE_LATERAL}
      WHERE COALESCE(r.is_return, false) = true
        AND r.unboxed_at IS NOT NULL
        AND r.organization_id = $1
        AND EXISTS (
          SELECT 1 FROM receiving_lines rl
           LEFT JOIN receiving_line_testing rlt ON rlt.receiving_line_id = rl.id AND rlt.organization_id = rl.organization_id
           WHERE rl.receiving_id = r.id
             AND rl.organization_id = $1
             AND COALESCE(rlt.needs_test, true) = true
             AND COALESCE(rl.workflow_status::text, '') NOT IN ('DONE','PASSED','FAILED','RTV','SCRAP')
        )
      ORDER BY r.unboxed_at DESC
      LIMIT 50`,
    [ctx.organizationId],
  );

  // Unboxed priority cartons (pending-order match or manual) ready to ship.
  // Bounded to a recent window as the v1 clear signal — there's no order-ship
  // hook yet, so the window keeps the bucket from growing without bound.
  const ordersRes = await tenantQuery<{
    receiving_id: number;
    line_id: number | null;
    tracking: string | null;
    order_number: string | null;
    product_title: string | null;
    unboxed_at: string | null;
  }>(
    ctx.organizationId,
    `SELECT r.id AS receiving_id,
            rep.line_id,
            stn.tracking_number_raw AS tracking,
            COALESCE(rep.source_order_id, rep.line_po, r.zoho_purchaseorder_number) AS order_number,
            rep.product_title,
            r.unboxed_at::text AS unboxed_at
       FROM receiving r
       LEFT JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
       ${REP_LINE_LATERAL}
      WHERE COALESCE(r.is_priority, false) = true
        AND COALESCE(r.is_return, false) = false
        AND r.unboxed_at IS NOT NULL
        AND r.unboxed_at > NOW() - interval '3 days'
        AND r.organization_id = $1
      ORDER BY r.unboxed_at DESC
      LIMIT 50`,
    [ctx.organizationId],
  );

  const items: TechQueueItem[] = [
    ...returnsRes.rows.map((row) => ({
      kind: 'return_pending_test' as const,
      receivingId: Number(row.receiving_id),
      lineId: row.line_id != null ? Number(row.line_id) : null,
      trackingNumber: row.tracking ?? null,
      orderNumber: row.order_number ?? null,
      productTitle: row.product_title ?? null,
      unboxedAt: row.unboxed_at ?? null,
    })),
    ...ordersRes.rows.map((row) => ({
      kind: 'order_ready_ship' as const,
      receivingId: Number(row.receiving_id),
      lineId: row.line_id != null ? Number(row.line_id) : null,
      trackingNumber: row.tracking ?? null,
      orderNumber: row.order_number ?? null,
      productTitle: row.product_title ?? null,
      unboxedAt: row.unboxed_at ?? null,
    })),
  ];

  return NextResponse.json({
    items,
    counts: {
      return_pending_test: returnsRes.rowCount ?? 0,
      order_ready_ship: ordersRes.rowCount ?? 0,
    },
  });
});
