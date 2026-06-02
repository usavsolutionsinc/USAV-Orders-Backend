/**
 * GET /api/shipped/summary
 *
 * Aggregate counts for the ShippedCarrierFilters sidebar tiles.
 * Uses the same source as the shipped dashboard table (station_activity_logs
 * + packer_logs + shipping_tracking_numbers) so tile counts match row counts.
 * Scoped to the last 30 days to match the default 1000-row table window.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_req: NextRequest) => {
  try {
    const r = await pool.query<{
      total: number;
      orders_count: number;
      fba_count: number;
      sku_count: number;
      needs_attention: number;
      exception: number;
      out_for_delivery: number;
      in_transit: number;
      label_created: number;
      accepted: number;
      delivered: number;
      returned: number;
    }>(`
      SELECT
        COUNT(DISTINCT sal.id)::int AS total,
        COUNT(DISTINCT sal.id) FILTER (
          WHERE COALESCE(pl.tracking_type, 'ORDERS') = 'ORDERS'
            AND COALESCE(sal.scan_ref, '') !~* '^FBA[0-9A-Z]{8,}$'
            AND sal.activity_type != 'FBA_READY'
        )::int AS orders_count,
        COUNT(DISTINCT sal.id) FILTER (
          WHERE COALESCE(pl.tracking_type, '') IN ('FBA', 'FNSKU')
            OR sal.activity_type = 'FBA_READY'
            OR COALESCE(sal.scan_ref, '') ~* '^FBA[0-9A-Z]{8,}$'
        )::int AS fba_count,
        COUNT(DISTINCT sal.id) FILTER (
          WHERE COALESCE(pl.tracking_type, '') = 'SKU'
        )::int AS sku_count,
        COUNT(DISTINCT sal.id) FILTER (
          WHERE stn.has_exception = true
            OR (
              COALESCE(stn.is_delivered, false) = false
              AND COALESCE(stn.is_terminal, false) = false
              AND stn.latest_event_at IS NOT NULL
              AND stn.latest_event_at < NOW() - INTERVAL '72 hours'
            )
        )::int AS needs_attention,
        COUNT(DISTINCT sal.id) FILTER (WHERE stn.latest_status_category = 'EXCEPTION')::int        AS exception,
        COUNT(DISTINCT sal.id) FILTER (WHERE stn.latest_status_category = 'OUT_FOR_DELIVERY')::int AS out_for_delivery,
        COUNT(DISTINCT sal.id) FILTER (WHERE stn.latest_status_category = 'IN_TRANSIT')::int       AS in_transit,
        COUNT(DISTINCT sal.id) FILTER (WHERE stn.latest_status_category = 'LABEL_CREATED')::int    AS label_created,
        COUNT(DISTINCT sal.id) FILTER (WHERE stn.latest_status_category = 'ACCEPTED')::int         AS accepted,
        COUNT(DISTINCT sal.id) FILTER (WHERE stn.latest_status_category = 'DELIVERED')::int        AS delivered,
        COUNT(DISTINCT sal.id) FILTER (WHERE stn.latest_status_category = 'RETURNED')::int         AS returned
      FROM station_activity_logs sal
      LEFT JOIN packer_logs pl ON pl.id = sal.packer_log_id
      LEFT JOIN shipping_tracking_numbers stn ON stn.id = sal.shipment_id
      WHERE sal.station = 'PACK'
        AND sal.created_at > NOW() - INTERVAL '30 days'
    `);

    const row = r.rows[0] ?? {
      total: 0, orders_count: 0, fba_count: 0, sku_count: 0,
      needs_attention: 0, exception: 0, out_for_delivery: 0,
      in_transit: 0, label_created: 0, accepted: 0, delivered: 0, returned: 0,
    };

    return NextResponse.json({ success: true, ...row });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to compute summary';
    console.error('shipped/summary failed:', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}, { permission: 'shipping.view' });
