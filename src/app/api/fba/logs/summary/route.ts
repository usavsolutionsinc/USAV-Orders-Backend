import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = String(searchParams.get('q') || '').trim();
    const modeParam = String(searchParams.get('mode') || 'ALL').trim().toUpperCase();
    let mode = 'ALL';
    if (modeParam === 'PLAN' || modeParam === 'PACKING' || modeParam === 'READY_TO_GO') mode = modeParam;
    if (modeParam === 'TESTED') mode = 'PLAN';
    if (modeParam === 'READY_TO_PRINT') mode = 'READY_TO_GO';
    const limitRaw = Number(searchParams.get('limit') || 200);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 500) : 200;

    const params: unknown[] = [];
    let idx = 1;
    const whereClauses: string[] = [];

    if (q) {
      whereClauses.push(
        `(sr.fnsku ILIKE $${idx}
          OR COALESCE(sr.product_title, '') ILIKE $${idx}
          OR COALESCE(sr.asin, '') ILIKE $${idx}
          OR COALESCE(sr.sku, '') ILIKE $${idx}
          OR COALESCE(sr.shipment_ref, '') ILIKE $${idx})`
      );
      params.push(`%${q}%`);
      idx += 1;
    }
    if (mode !== 'ALL') {
      whereClauses.push(`sr.workflow_mode = $${idx}`);
      params.push(mode);
      idx += 1;
    }
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    params.push(limit);
    const limitIdx = idx;

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
        latest_serial AS (
          SELECT DISTINCT ON (tsn.fnsku)
            tsn.fnsku,
            tsn.serial_number
          FROM tech_serial_numbers tsn
          WHERE tsn.fnsku IS NOT NULL
            AND COALESCE(BTRIM(tsn.serial_number), '') <> ''
          ORDER BY tsn.fnsku, tsn.created_at DESC NULLS LAST, tsn.id DESC
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
        ),
        summary_rows AS (
          SELECT
            ff.fnsku,
            ff.product_title,
            ff.asin,
            ff.sku,
            ls.serial_number AS latest_serial_number,
            ff.is_active,
            lt.tech_scanned_qty,
            lt.pack_ready_qty,
            lt.shipped_qty,
            GREATEST(lt.tech_scanned_qty - lt.pack_ready_qty, 0)::int AS currently_packing_qty,
            GREATEST(LEAST(lt.tech_scanned_qty, lt.pack_ready_qty) - lt.shipped_qty, 0)::int AS ready_to_print_qty,
            GREATEST(LEAST(lt.tech_scanned_qty, lt.pack_ready_qty) - lt.shipped_qty, 0)::int AS available_to_ship,
            CASE
              WHEN GREATEST(LEAST(lt.tech_scanned_qty, lt.pack_ready_qty) - lt.shipped_qty, 0) > 0 THEN 'READY_TO_GO'
              WHEN GREATEST(lt.tech_scanned_qty - lt.pack_ready_qty, 0) > 0 THEN 'PACKING'
              WHEN lt.tech_scanned_qty > 0 THEN 'PLAN'
              ELSE 'NONE'
            END AS workflow_mode,
            lt.last_event_at,
            oi.shipment_id,
            oi.shipment_ref,
            oi.shipment_item_id,
            oi.status AS shipment_item_status,
            oi.expected_qty,
            oi.actual_qty
          FROM log_totals lt
          JOIN fba_fnskus ff ON ff.fnsku = lt.fnsku
          LEFT JOIN latest_serial ls ON ls.fnsku = lt.fnsku
          LEFT JOIN open_items oi ON oi.fnsku = lt.fnsku
        )
        SELECT
          sr.fnsku,
          sr.product_title,
          sr.asin,
          sr.sku,
          sr.latest_serial_number,
          sr.is_active,
          sr.tech_scanned_qty,
          sr.pack_ready_qty,
          sr.shipped_qty,
          sr.currently_packing_qty,
          sr.ready_to_print_qty,
          sr.available_to_ship,
          sr.workflow_mode,
          sr.last_event_at,
          sr.shipment_id,
          sr.shipment_ref,
          sr.shipment_item_id,
          sr.shipment_item_status,
          sr.expected_qty,
          sr.actual_qty
        FROM summary_rows sr
        ${whereSql}
        ORDER BY sr.ready_to_print_qty DESC, sr.currently_packing_qty DESC, sr.last_event_at DESC NULLS LAST, sr.fnsku ASC
        LIMIT $${limitIdx}
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
