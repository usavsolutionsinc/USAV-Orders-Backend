import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { withAuth } from '@/lib/auth/withAuth';

export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const { searchParams } = new URL(req.url);
    const tier = searchParams.get('tier');
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '200', 10) || 200, 1),
      2000,
    );
    const params: unknown[] = [];
    // Pin the org param to a fixed leading index so the org-scoped base-table
    // CTEs can reference it while the optional tier / limit predicates keep
    // their original dynamic $N numbering after it.
    params.push(ctx.organizationId);
    const orgIdx = params.length; // $1
    const clauses: string[] = [];
    if (tier === 'A' || tier === 'B' || tier === 'C' || tier === 'D') {
      params.push(tier);
      clauses.push(`velocity_tier = $${params.length}`);
    }
    params.push(limit);
    const limitIdx = params.length;
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    // TENANT ISOLATION: mv_sku_velocity_30d is a cross-tenant-collapsed
    // materialized view — it GROUP BYs on the bare `sku` string and string-key
    // JOINs (sku_stock/sku_catalog ON sku) with NO organization_id, so once a
    // second org carries the same SKU string its movement/stock rows merge and
    // the MV leaks across tenants. RLS does not apply to MV rows, so the GUC
    // alone can't fix it. The org dimension DOES exist on the base tables
    // (sku_stock_ledger / sku_stock / sku_catalog / sku_platform_ids all carry
    // organization_id — 2026-05-23_org_id_on_business_tables.sql), so we bypass
    // the leaky MV and recompute the same projection directly from the
    // org-bearing base tables, scoping every table to ctx.organizationId and
    // pinning every `sku` string-key JOIN to the same org. This serves only the
    // caller's own velocity; output column shape is unchanged. (The MV remains
    // for any future per-org-MV redesign; this route no longer reads it.)
    const r = await tenantQuery(
      ctx.organizationId,
      `WITH movement AS (
         SELECT
           sku,
           SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END)::int AS out_qty,
           SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END)::int  AS in_qty,
           MAX(created_at)                                       AS last_move_at
         FROM sku_stock_ledger
         WHERE created_at >= NOW() - INTERVAL '30 days'
           AND reason <> 'INITIAL_BALANCE'
           AND organization_id = $${orgIdx}
         GROUP BY sku
       ),
       velocity AS (
         SELECT
           m.sku,
           m.out_qty,
           m.in_qty,
           m.last_move_at,
           ss.stock AS current_stock,
           COALESCE(
             NULLIF(ss.display_name_override, ''),
             sp.display_name,
             sc.product_title,
             NULLIF(ss.product_title, '')
           ) AS product_title,
           CASE
             WHEN m.out_qty >= 50 THEN 'A'
             WHEN m.out_qty >= 10 THEN 'B'
             WHEN m.out_qty >  0  THEN 'C'
             ELSE 'D'
           END AS velocity_tier
         FROM movement m
         LEFT JOIN sku_stock ss
           ON ss.sku = m.sku
          AND ss.organization_id = $${orgIdx}
         LEFT JOIN sku_catalog sc
           ON sc.sku = m.sku
          AND sc.organization_id = $${orgIdx}
         LEFT JOIN LATERAL (
           SELECT e.display_name FROM sku_platform_ids e
           WHERE e.sku_catalog_id = sc.id
             AND e.organization_id = sc.organization_id
             AND e.platform = 'ecwid' AND e.is_active = true
             AND e.display_name IS NOT NULL
           LIMIT 1
         ) sp ON TRUE
       )
       SELECT sku, product_title, current_stock, out_qty, in_qty,
              last_move_at, velocity_tier
       FROM velocity
       ${where}
       ORDER BY out_qty DESC, in_qty DESC
       LIMIT $${limitIdx}`,
      params,
    );
    return NextResponse.json({ success: true, rows: r.rows });
  } catch (err: any) {
    console.error('[GET /api/reports/velocity] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed' },
      { status: 500 },
    );
  }
}, { permission: 'reports.view' });
