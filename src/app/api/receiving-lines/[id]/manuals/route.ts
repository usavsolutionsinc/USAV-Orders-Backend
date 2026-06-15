import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { setManualSkuCatalogId } from '@/lib/neon/product-manuals-queries';
import { resolveOrCreateLineCatalog } from '@/lib/receiving/line-catalog';

/**
 * Pair / unpair a library manual to the SKU catalog row resolved from a
 * receiving line. Tech-facing (`tech.qc_pass`) so testers can attach the right
 * manual from the testing screen. Pairing creates the catalog row on demand.
 */
function lineIdFromPath(pathname: string): number {
  const segments = pathname.split('/').filter(Boolean);
  // .../api/receiving-lines/[id]/manuals → id is segments[-2]
  return Number(segments[segments.length - 2]);
}

async function manualIdFromBody(request: Request): Promise<number> {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    /* tolerate empty */
  }
  return Number(body.manualId);
}

/**
 * Ownership gate for unpair. product_manuals has NO organization_id column, so
 * isolation comes from its parent sku_catalog row. A manual is "this org's" only
 * when it's currently paired to a catalog row owned by ctx.organizationId.
 * Returns false for a foreign-org or already-unpaired manual id → the caller
 * 404s instead of mutating another tenant's (or a parent-less) row.
 */
async function manualOwnedByOrg(manualId: number, orgId: OrgId): Promise<boolean> {
  const res = await tenantQuery<{ id: number }>(
    orgId,
    `SELECT pm.id
       FROM product_manuals pm
       JOIN sku_catalog sc ON sc.id = pm.sku_catalog_id
      WHERE pm.id = $1 AND pm.is_active = TRUE
        AND sc.organization_id = $2
      LIMIT 1`,
    [manualId, orgId],
  );
  return res.rows.length > 0;
}

export const POST = withAuth(async (request, ctx) => {
  const lineId = lineIdFromPath(request.nextUrl.pathname);
  const manualId = await manualIdFromBody(request);
  if (!Number.isFinite(lineId) || lineId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid line id' }, { status: 400 });
  }
  if (!Number.isFinite(manualId) || manualId <= 0) {
    return NextResponse.json({ ok: false, error: 'manualId is required' }, { status: 400 });
  }

  try {
    // [id]/verb write: thread the org so the line→catalog resolution is scoped
    // to ctx.organizationId (a foreign line 404s, create-on-demand stamps this
    // org). product_manuals has NO organization_id column (NEEDS-COL), so the
    // pairing write can only be GUC-wrapped via the threaded orgId — RLS gates
    // it once enforced.
    const resolved = await resolveOrCreateLineCatalog(lineId, ctx.organizationId);
    if (!resolved) {
      return NextResponse.json({ ok: false, error: 'line not found' }, { status: 404 });
    }
    if (resolved.skuCatalogId == null) {
      return NextResponse.json(
        { ok: false, error: 'could not resolve or create a catalog entry for this SKU' },
        { status: 409 },
      );
    }
    const manual = await setManualSkuCatalogId(manualId, resolved.skuCatalogId, ctx.organizationId);
    if (!manual) {
      return NextResponse.json({ ok: false, error: 'manual not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, skuCatalogId: resolved.skuCatalogId, manual });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to pair manual';
    console.error('[POST /api/receiving-lines/[id]/manuals] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, {
  permission: 'tech.qc_pass',
  audit: {
    source: 'tech',
    action: 'manual.pair',
    entityType: 'product_manual',
    entityId: ({ body }) => (body as { manualId?: number })?.manualId ?? null,
  },
});

export const DELETE = withAuth(async (request, ctx) => {
  const lineId = lineIdFromPath(request.nextUrl.pathname);
  const manualId = await manualIdFromBody(request);
  if (!Number.isFinite(lineId) || lineId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid line id' }, { status: 400 });
  }
  if (!Number.isFinite(manualId) || manualId <= 0) {
    return NextResponse.json({ ok: false, error: 'manualId is required' }, { status: 400 });
  }

  try {
    // [id]/verb write: product_manuals has no org column, so gate on the
    // manual's parent-catalog ownership (404 — never 403 — on a foreign or
    // already-unpaired manual) before mutating. Then thread orgId so the
    // unpair write is GUC-wrapped for the RLS backstop.
    if (!(await manualOwnedByOrg(manualId, ctx.organizationId))) {
      return NextResponse.json({ ok: false, error: 'manual not found' }, { status: 404 });
    }
    const manual = await setManualSkuCatalogId(manualId, null, ctx.organizationId);
    if (!manual) {
      return NextResponse.json({ ok: false, error: 'manual not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, manual });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to unpair manual';
    console.error('[DELETE /api/receiving-lines/[id]/manuals] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, {
  permission: 'tech.qc_pass',
  audit: {
    source: 'tech',
    action: 'manual.unpair',
    entityType: 'product_manual',
    entityId: ({ body }) => (body as { manualId?: number })?.manualId ?? null,
  },
});
