import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { isTransientDbError, queryWithRetry } from '@/lib/db-retry';
import { withAuth } from '@/lib/auth/withAuth';

// ── GET /api/fba/items/queue ──────────────────────────────────────────────────
// Returns individual FNSKU items from all active (non-SHIPPED) FBA shipments,
// joined with their shipment context. Used by UpNextOrder FBA tab.
// Query params: status (comma-sep, default PLANNED,TESTED,PACKED,LABEL_ASSIGNED), limit
export const GET = withAuth(async (request: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status') || 'PLANNED,TESTED,PACKED,LABEL_ASSIGNED';
    const limitRaw = Number(searchParams.get('limit') || 100);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 100;

    const statuses = statusParam
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const result = await queryWithRetry(
      () => tenantQuery(
        ctx.organizationId,
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
         JOIN fba_shipments fs ON fs.id = fsi.shipment_id AND fs.organization_id = $3
         LEFT JOIN fba_fnskus ff ON ff.fnsku = fsi.fnsku AND ff.organization_id = $3
         LEFT JOIN staff tech ON tech.id = fs.assigned_tech_id
         WHERE fsi.status = ANY($1::fba_shipment_status_enum[])
           AND fs.status != 'SHIPPED'
           AND fsi.organization_id = $3
         ORDER BY
           CASE fsi.status
             WHEN 'PACKED'         THEN 1
             WHEN 'TESTED'         THEN 2
             WHEN 'PLANNED'        THEN 3
             WHEN 'LABEL_ASSIGNED' THEN 4
             ELSE 5
           END,
           fs.due_date ASC NULLS LAST,
           fsi.fnsku
         LIMIT $2`,
        [statuses, limit, ctx.organizationId]
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
}, { permission: 'fba.view' });
