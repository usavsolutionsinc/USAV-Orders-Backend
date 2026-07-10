import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import type { Warehouse } from '@/lib/warehouses';

// NOTE(plan-ceilings): there is no warehouse-CREATE route yet (this file is
// read-only). When one is added it must check
// wouldExceedPlanCeiling(ctx.organizationId, 'maxWarehouses')
// (src/lib/billing/plan-ceilings.ts) before inserting and return
// 403 { ok:false, error:'PLAN_LIMIT', limit:'maxWarehouses', upgrade:true }.

export const GET = withAuth(async (_request, ctx) => {
  try {
    // `warehouses` has no organization_id column (tenant-owned-NEEDS-COL), so
    // there is no explicit org filter to add — run the read GUC-wrapped via
    // tenantQuery so it is RLS-subject once per-table FORCE is enabled. SQL +
    // response shape are identical to the prior listWarehouses() passthrough.
    const result = await tenantQuery<Warehouse>(
      ctx.organizationId,
      `SELECT id, code, name, timezone, is_active, is_default
       FROM warehouses
       WHERE is_active = true
       ORDER BY is_default DESC, code ASC`,
    );
    return NextResponse.json({ success: true, warehouses: result.rows });
  } catch (err: any) {
    console.error('[GET /api/warehouses] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.view' });
