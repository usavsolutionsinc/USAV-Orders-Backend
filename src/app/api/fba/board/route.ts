import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';
import { getOrSet } from '@/lib/cache/upstash-cache';
import { CACHE_NS, CACHE_TAGS } from '@/lib/cache/tags';

/**
 * GET /api/fba/board
 *
 * Simple Google-Sheets-style payload for small-team operations:
 * - `pending`: all non-shipped lines (single table source)
 * - `shipped`: all shipped lines (optional compatibility/read model)
 *
 * Legacy keys (`awaiting`, `packed`, `paired`) are still returned as empty arrays
 * so older clients do not crash during rollout.
 */
export const GET = withAuth(async (_request: NextRequest, ctx) => {
  try {
    // Heavy per-scan board aggregation → short-TTL cache; every FBA write busts
    // fba-board/fba-stage-counts (org-scoped) so the board stays fresh.
    const pending = await getOrSet<unknown[]>(
      CACHE_NS.fbaBoard,
      ctx.organizationId,
      'board',
      20,
      [CACHE_TAGS.fbaBoard, CACHE_TAGS.fbaStageCounts],
      async () => {
    const result = await tenantQuery(
      ctx.organizationId,
      `WITH pending_rows AS (
         SELECT
           fsi.id AS item_id,
           fsi.fnsku,
           fsi.expected_qty,
           fsi.actual_qty,
           fsi.status AS item_status,
           COALESCE(ff.product_title, fsi.fnsku) AS display_title,
           fsi.asin,
           fsi.sku,
           fsi.notes AS item_notes,
           ff.condition AS condition,
           fsi.ready_at,
           fsi.updated_at AS item_updated_at,
           fs.id AS shipment_id,
           fs.shipment_ref,
           fs.amazon_shipment_id,
           fs.due_date,
           fs.status AS shipment_status,
           fs.destination_fc,
           fs.updated_at AS shipment_updated_at
         FROM fba_shipment_items fsi
         JOIN fba_shipments fs ON fs.id = fsi.shipment_id
         LEFT JOIN fba_fnskus ff ON ff.fnsku = fsi.fnsku AND ff.organization_id = fsi.organization_id
         WHERE fs.status != 'SHIPPED'
           AND fsi.status NOT IN ('SHIPPED', 'LABEL_ASSIGNED')
           AND fsi.organization_id = $1
       ),
       grouped AS (
         SELECT
           UPPER(TRIM(pr.fnsku)) AS fnsku_key,
           SUM(COALESCE(pr.expected_qty, 0))::int AS expected_qty,
           SUM(COALESCE(pr.actual_qty, 0))::int AS actual_qty,
           CASE
             WHEN BOOL_OR(pr.item_status = 'PACKED') THEN 'PACKED'
             WHEN BOOL_OR(pr.item_status = 'TESTED') THEN 'TESTED'
             ELSE 'PLANNED'
           END AS item_status,
           ARRAY_AGG(DISTINCT pr.shipment_id ORDER BY pr.shipment_id) AS shipment_ids,
           MAX(COALESCE(pr.item_updated_at, pr.shipment_updated_at)) AS last_activity_at
         FROM pending_rows pr
         GROUP BY UPPER(TRIM(pr.fnsku))
       ),
       canonical AS (
         SELECT
           pr.*,
           ROW_NUMBER() OVER (
             PARTITION BY UPPER(TRIM(pr.fnsku))
             ORDER BY
               CASE pr.item_status
                 WHEN 'PACKED' THEN 0
                 WHEN 'TESTED' THEN 1
                 WHEN 'PLANNED' THEN 2
                 ELSE 9
               END ASC,
               COALESCE(pr.item_updated_at, pr.shipment_updated_at) DESC NULLS LAST,
               pr.shipment_id DESC,
               pr.item_id DESC
           ) AS rn
         FROM pending_rows pr
       )
       SELECT
         c.item_id,
         c.fnsku AS fnsku,
         g.expected_qty,
         g.actual_qty,
         g.item_status,
         c.display_title,
         c.asin,
         c.sku,
         c.item_notes,
         c.condition,
         c.ready_at,
         NULL::timestamptz AS shipped_at,
         c.shipment_id,
         c.shipment_ref,
         c.amazon_shipment_id,
         NULL::date AS due_date,
         c.shipment_status,
         c.destination_fc,
         g.shipment_ids,
         COALESCE(
           (
             SELECT jsonb_agg(
               DISTINCT jsonb_build_object(
                 'tracking_number', stn.tracking_number_raw,
                 'carrier', stn.carrier,
                 'label', fst.label
               )
             )
             FROM fba_shipment_tracking fst
             JOIN shipping_tracking_numbers stn ON stn.id = fst.tracking_id
             WHERE fst.shipment_id = ANY(g.shipment_ids)
               AND fst.organization_id = $1
           ),
           '[]'::jsonb
         ) AS tracking_numbers
       FROM grouped g
       JOIN canonical c ON UPPER(TRIM(c.fnsku)) = g.fnsku_key AND c.rn = 1
       ORDER BY
         CASE g.item_status
           WHEN 'PACKED' THEN 0
           WHEN 'TESTED' THEN 1
           WHEN 'PLANNED' THEN 2
           ELSE 9
         END ASC,
         g.last_activity_at DESC NULLS LAST,
         c.fnsku ASC`,
      [ctx.organizationId]
    );
    return result.rows;
      },
    );

    return NextResponse.json({
      success: true,
      pending,
      shipped: [],
      // legacy response shape support
      awaiting: [],
      packed: [],
      paired: [],
    });
  } catch (error: any) {
    console.error('[GET /api/fba/board]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch FBA board' },
      { status: 500 }
    );
  }
}, { permission: 'fba.view', feature: 'fba' });
