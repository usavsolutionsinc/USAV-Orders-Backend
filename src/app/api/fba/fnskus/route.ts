import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { publishFbaCatalogChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { withAuth } from '@/lib/auth/withAuth';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

// ── POST /api/fba/fnskus ──────────────────────────────────────────────────────
// Add a new FNSKU to the fba_fnskus catalog.
// Body: { fnsku, product_title?, asin?, sku? }
export const POST = withAuth(async (request: NextRequest, ctx) => {
  try {
    const body = await request.json();
    const fnsku = String(body?.fnsku || '').trim().toUpperCase();
    if (!fnsku) {
      return NextResponse.json({ success: false, error: 'fnsku is required' }, { status: 400 });
    }

    const product_title = String(body?.product_title || '').trim() || null;
    const asin = String(body?.asin || '').trim().toUpperCase() || null;
    const sku = String(body?.sku || '').trim() || null;
    const condition = String(body?.condition || '').trim() || null;

    const result = await tenantQuery(
      ctx.organizationId,
      `INSERT INTO fba_fnskus (fnsku, product_title, asin, sku, condition, organization_id, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, NOW(), NOW())
       ON CONFLICT (organization_id, fnsku) DO UPDATE
         SET product_title = COALESCE(EXCLUDED.product_title, fba_fnskus.product_title),
             asin          = COALESCE(EXCLUDED.asin, fba_fnskus.asin),
             sku           = COALESCE(EXCLUDED.sku, fba_fnskus.sku),
             condition     = EXCLUDED.condition,
             is_active     = true,
             updated_at    = NOW()
       WHERE fba_fnskus.organization_id = $6 OR fba_fnskus.organization_id IS NULL
       RETURNING fnsku, product_title, asin, sku, condition, is_active, created_at`,
      [fnsku, product_title, asin, sku, condition, ctx.organizationId]
    );

    await invalidateCacheTags(['fba-fnskus']);
    await publishFbaCatalogChanged({ action: 'created', fnsku: fnsku || '', source: 'fba.fnskus.create', organizationId: ctx.organizationId });

    return NextResponse.json({ success: true, fnsku: result.rows[0] });
  } catch (error: any) {
    console.error('[POST /api/fba/fnskus]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to add FNSKU' },
      { status: 500 }
    );
  }
}, {
  permission: 'fba.manage_fnskus',
  audit: {
    source: 'fba.fnskus.create',
    action: 'fba.fnsku.create',
    entityType: 'fba_fnsku',
    entityId: ({ response }) => {
      const r = response as { fnsku?: { fnsku?: string } } | null;
      return r?.fnsku?.fnsku ?? null;
    },
  },
});
