import { NextRequest, NextResponse } from 'next/server';
import { tenantQuery } from '@/lib/tenancy/db';
import { publishFbaCatalogChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { requireRoutePerm, recordRouteAudit } from '@/lib/auth/dynamic-route-guard';

// ── PATCH /api/fba/fnskus/[fnsku] ────────────────────────────────────────────
// Update catalog fields for an existing FNSKU.
// Body: { product_title?, asin?, sku? }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ fnsku: string }> },
) {
  try {
    const gate = await requireRoutePerm(request, 'fba.manage_fnskus');
    if (gate.denied) return gate.denied;
    const { fnsku: rawFnsku } = await params;
    const fnsku = decodeURIComponent(rawFnsku).trim().toUpperCase();
    if (!fnsku) {
      return NextResponse.json({ success: false, error: 'fnsku is required' }, { status: 400 });
    }

    const body = await request.json();
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if ('product_title' in body) {
      sets.push(`product_title = $${idx++}`);
      vals.push(body.product_title ?? null);
    }
    if ('asin' in body) {
      sets.push(`asin = $${idx++}`);
      vals.push(body.asin ? String(body.asin).trim().toUpperCase() : null);
    }
    if ('sku' in body) {
      sets.push(`sku = $${idx++}`);
      vals.push(body.sku ? String(body.sku).trim() : null);
    }
    if ('condition' in body) {
      sets.push(`condition = $${idx++}`);
      vals.push(body.condition ? String(body.condition).trim() : null);
    }

    if (sets.length === 0) {
      return NextResponse.json({ success: false, error: 'Nothing to update' }, { status: 400 });
    }

    sets.push(`updated_at = NOW()`);
    vals.push(fnsku);
    const fnskuIdx = idx++;
    vals.push(gate.ctx.organizationId);

    const result = await tenantQuery(
      gate.ctx.organizationId,
      `UPDATE fba_fnskus SET ${sets.join(', ')} WHERE fnsku = $${fnskuIdx} AND organization_id = $${idx} RETURNING fnsku, product_title, asin, sku, condition`,
      vals,
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ success: false, error: 'FNSKU not found' }, { status: 404 });
    }

    await invalidateCacheTags(['fba-fnskus']);
    await publishFbaCatalogChanged({ action: 'updated', fnsku: fnsku || '', source: 'fba.fnskus.update', organizationId: gate.ctx.organizationId });

    const response = NextResponse.json({ success: true, fnsku: result.rows[0] });
    await recordRouteAudit(request, gate.ctx, response, {
      source: 'fba.fnskus.update',
      action: 'fba.fnsku.update',
      entityType: 'fba_fnsku',
      entityId: () => fnsku,
    });
    return response;
  } catch (error: any) {
    console.error('[PATCH /api/fba/fnskus/[fnsku]]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to update FNSKU' },
      { status: 500 },
    );
  }
}

// ── GET /api/fba/fnskus/[fnsku] ──────────────────────────────────────────────
// Fetch a single FNSKU record.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fnsku: string }> },
) {
  try {
    const gate = await requireRoutePerm(request, 'fba.view');
    if (gate.denied) return gate.denied;
    const { fnsku: rawFnsku } = await params;
    const fnsku = decodeURIComponent(rawFnsku).trim().toUpperCase();
    if (!fnsku) {
      return NextResponse.json({ success: false, error: 'fnsku is required' }, { status: 400 });
    }

    const result = await tenantQuery(
      gate.ctx.organizationId,
      `SELECT fnsku, product_title, asin, sku, condition, is_active, created_at, updated_at FROM fba_fnskus WHERE fnsku = $1 AND organization_id = $2`,
      [fnsku, gate.ctx.organizationId],
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ success: false, error: 'FNSKU not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, fnsku: result.rows[0] });
  } catch (error: any) {
    console.error('[GET /api/fba/fnskus/[fnsku]]', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to fetch FNSKU' },
      { status: 500 },
    );
  }
}
