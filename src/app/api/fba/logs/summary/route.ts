import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = String(searchParams.get('q') || '').trim();
    const limitRaw = Number(searchParams.get('limit') || 200);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 500) : 200;

    const params: unknown[] = [];
    let idx = 1;
    let whereSql = '';

    if (q) {
      whereSql = `
        WHERE (
          ff.fnsku ILIKE $${idx}
          OR COALESCE(ff.product_title, '') ILIKE $${idx}
          OR COALESCE(ff.asin, '') ILIKE $${idx}
          OR COALESCE(ff.sku, '') ILIKE $${idx}
          OR COALESCE(oi.shipment_ref, '') ILIKE $${idx}
        )
      `;
      params.push(`%${q}%`);
      idx++;
    }

    params.push(limit);

    const result = await pool.query(
      `
        WITH log_totals AS (
          SELECT
            l.fnsku,
            COALESCE(SUM(l.quantity) FILTER (WHERE l.source_stage = 'TECH' AND l.event_type = 'SCANNED'), 0)::int AS tech_scanned_qty,
            COALESCE(SUM(l.quantity) FILTER (WHERE l.source_stage = 'PACK' AND l.event_type IN ('READY', 'VERIFIED', 'BOXED')), 0)::int AS pack_ready_qty,
            COALESCE(SUM(l.quantity) FILTER (WHERE l.source_stage = 'SHIP' AND l.event_type = 'SHIPPED'), 0)::int AS shipped_qty,
            MAX(l.created_at) AS last_event_at
          FROM fba_fnsku_logs l
          WHERE l.event_type != 'VOID'
          GROUP BY l.fnsku
        ),
        open_items AS (
          SELECT DISTINCT ON (fsi.fnsku)
            fsi.fnsku,
            fs.id AS shipment_id,
            fs.shipment_ref,
            fsi.id AS shipment_item_id,
            fsi.status,
            fsi.expected_qty,
            fsi.actual_qty
          FROM fba_shipment_items fsi
          JOIN fba_shipments fs ON fs.id = fsi.shipment_id
          WHERE fs.status != 'SHIPPED'
            AND fsi.status != 'SHIPPED'
          ORDER BY
            fsi.fnsku,
            CASE fsi.status
              WHEN 'PLANNED' THEN 1
              WHEN 'READY_TO_GO' THEN 2
              WHEN 'LABEL_ASSIGNED' THEN 3
              ELSE 4
            END,
            fs.created_at ASC,
            fsi.id ASC
        )
        SELECT
          ff.fnsku,
          ff.product_title,
          ff.asin,
          ff.sku,
          ff.is_active,
          lt.tech_scanned_qty,
          lt.pack_ready_qty,
          lt.shipped_qty,
          GREATEST(LEAST(lt.tech_scanned_qty, lt.pack_ready_qty) - lt.shipped_qty, 0)::int AS available_to_ship,
          lt.last_event_at,
          oi.shipment_id,
          oi.shipment_ref,
          oi.shipment_item_id,
          oi.status AS shipment_item_status,
          oi.expected_qty,
          oi.actual_qty
        FROM log_totals lt
        JOIN fba_fnskus ff ON ff.fnsku = lt.fnsku
        LEFT JOIN open_items oi ON oi.fnsku = lt.fnsku
        ${whereSql}
        ORDER BY available_to_ship DESC, lt.last_event_at DESC NULLS LAST, ff.fnsku ASC
        LIMIT $${idx}
      `,
      params
    );

    return NextResponse.json({ success: true, rows: result.rows });
  } catch (error: any) {
    console.error('[GET /api/fba/logs/summary]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch FBA summary' },
      { status: 500 }
    );
  }
}
