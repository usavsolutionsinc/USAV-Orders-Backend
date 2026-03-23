import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { isTransientDbError, queryWithRetry } from '@/lib/db-retry';

// ── GET /api/fba/items/queue ──────────────────────────────────────────────────
// Returns individual FNSKU items from all active (non-SHIPPED) FBA shipments,
// joined with their shipment context. Used by UpNextOrder FBA tab.
// Query params: status (comma-sep, default PLANNED,READY_TO_GO,LABEL_ASSIGNED), limit
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status') || 'PLANNED,READY_TO_GO,LABEL_ASSIGNED';
    const limitRaw = Number(searchParams.get('limit') || 100);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;

    const statuses = statusParam
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const result = await queryWithRetry(
      () => pool.query(
        `SELECT
           fsi.id           AS item_id,
           fsi.shipment_id,
           fs.shipment_ref,
           fs.assigned_tech_id,
           fs.assigned_packer_id,
           fs.destination_fc,
           fs.due_date,
           fs.due_date      AS deadline_at,
           COALESCE(NULLIF(fs.notes, ''), fs.shipment_ref) AS plan_title,
           fsi.fnsku,
           fsi.product_title,
           fsi.asin,
           fsi.sku,
           NULLIF(COALESCE(to_jsonb(ff)->>'condition', to_jsonb(ff)->>'condition_grade'), '') AS condition,
           fsi.expected_qty,
           fsi.actual_qty,
           fsi.status,
           fsi.ready_at,
           tech.name        AS assigned_tech_name
         FROM fba_shipment_items fsi
         JOIN fba_shipments fs ON fs.id = fsi.shipment_id
         LEFT JOIN fba_fnskus ff ON ff.fnsku = fsi.fnsku
         LEFT JOIN staff tech ON tech.id = fs.assigned_tech_id
         WHERE fsi.status = ANY($1::fba_shipment_status_enum[])
           AND fs.status != 'SHIPPED'
         ORDER BY
           CASE fsi.status
             WHEN 'READY_TO_GO'    THEN 1
             WHEN 'PLANNED'        THEN 2
             WHEN 'LABEL_ASSIGNED' THEN 3
             ELSE 4
           END,
           fs.due_date ASC NULLS LAST,
           fsi.fnsku
         LIMIT $2`,
        [statuses, limit]
      ),
      { retries: 3, delayMs: 1000 },
    );

    return NextResponse.json({ success: true, items: result.rows });
  } catch (error: any) {
    if (isTransientDbError(error)) {
      return NextResponse.json(
        { success: true, items: [], fallback: 'db_unavailable' },
        { headers: { 'x-db-fallback': 'unavailable' } }
      );
    }
    console.error('[GET /api/fba/items/queue]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch FBA queue' },
      { status: 500 }
    );
  }
}
