import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import { getOrSet } from '@/lib/cache/upstash-cache';
import { CACHE_NS, CACHE_TAGS } from '@/lib/cache/tags';

/**
 * GET /api/fba/shipments/today
 *
 * Returns today's PLANNED shipment and its items (for duplicate detection).
 * "Today" is based on the server's local date (due_date = CURRENT_DATE).
 *
 * Response:
 * {
 *   success: true,
 *   shipment: { id, shipment_ref, due_date, items: [{ id, fnsku, expected_qty, status }] } | null
 * }
 */
export const GET = withAuth(async (_request, ctx) => {
  try {
    // Per-scan "today's shipment" snapshot → short-TTL cache (20s bounds tracking-
    // status staleness); FBA writes bust fba-today/fba-stage-counts org-scoped.
    const cached = await getOrSet<{ shipment: unknown }>(
      CACHE_NS.fbaToday,
      ctx.organizationId,
      'today',
      20,
      [CACHE_TAGS.fbaToday, CACHE_TAGS.fbaStageCounts],
      async () => {
    const shipRes = await tenantQuery(ctx.organizationId, `
      SELECT id, shipment_ref, due_date, status, amazon_shipment_id
      FROM fba_shipments
      WHERE due_date = CURRENT_DATE AND status = 'PLANNED'
        AND organization_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [ctx.organizationId]);

    if (shipRes.rows.length === 0) {
      return { shipment: null };
    }

    const shipment = shipRes.rows[0];

    const itemsRes = await tenantQuery(ctx.organizationId, `
      SELECT fsi.id, fsi.fnsku, fsi.expected_qty, fsi.status,
             COALESCE(ff.product_title, fsi.fnsku) AS display_title,
             fsi.asin, fsi.sku,
             fsi.ready_by_staff_id,
             fsi.verified_by_staff_id,
             r.name  AS ready_by_name,
             v.name  AS verified_by_name
      FROM fba_shipment_items fsi
      LEFT JOIN fba_fnskus ff ON ff.fnsku = fsi.fnsku AND ff.organization_id = fsi.organization_id
      LEFT JOIN staff r ON r.id = fsi.ready_by_staff_id
      LEFT JOIN staff v ON v.id = fsi.verified_by_staff_id
      WHERE fsi.shipment_id = $1 AND fsi.organization_id = $2
      ORDER BY fsi.created_at ASC
    `, [shipment.id, ctx.organizationId]);

    const trackingRes = await tenantQuery(ctx.organizationId,
      `SELECT
         fst.id          AS link_id,
         fst.label,
         fst.created_at  AS linked_at,
         stn.id          AS tracking_id,
         stn.tracking_number_raw AS tracking_number,
         stn.tracking_number_normalized,
         stn.carrier,
         stn.latest_status_category AS status_category,
         stn.latest_status_description AS status_description,
         stn.is_label_created,
         stn.is_carrier_accepted,
         stn.is_in_transit,
         stn.is_out_for_delivery,
         stn.is_delivered,
         stn.has_exception,
         stn.is_terminal,
         stn.delivered_at,
         stn.latest_event_at
       FROM fba_shipment_tracking fst
       JOIN shipping_tracking_numbers stn ON stn.id = fst.tracking_id
       WHERE fst.shipment_id = $1 AND fst.organization_id = $2
       ORDER BY fst.created_at DESC`,
      [shipment.id, ctx.organizationId]
    );

    return {
      shipment: {
        id: shipment.id,
        shipment_ref: shipment.shipment_ref,
        due_date: shipment.due_date,
        status: shipment.status,
        amazon_shipment_id: shipment.amazon_shipment_id ?? null,
        tracking_numbers: trackingRes.rows,
        items: itemsRes.rows,
      },
    };
      },
    );

    return NextResponse.json({ success: true, shipment: cached.shipment });
  } catch (error: any) {
    console.error('[GET /api/fba/shipments/today]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed' },
      { status: 500 }
    );
  }
}, { permission: 'fba.view' });
