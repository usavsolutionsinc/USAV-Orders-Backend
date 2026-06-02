import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
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

export const POST = withAuth(async (request) => {
  const lineId = lineIdFromPath(request.nextUrl.pathname);
  const manualId = await manualIdFromBody(request);
  if (!Number.isFinite(lineId) || lineId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid line id' }, { status: 400 });
  }
  if (!Number.isFinite(manualId) || manualId <= 0) {
    return NextResponse.json({ ok: false, error: 'manualId is required' }, { status: 400 });
  }

  try {
    const resolved = await resolveOrCreateLineCatalog(lineId);
    if (!resolved) {
      return NextResponse.json({ ok: false, error: 'line not found' }, { status: 404 });
    }
    if (resolved.skuCatalogId == null) {
      return NextResponse.json(
        { ok: false, error: 'could not resolve or create a catalog entry for this SKU' },
        { status: 409 },
      );
    }
    const manual = await setManualSkuCatalogId(manualId, resolved.skuCatalogId);
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

export const DELETE = withAuth(async (request) => {
  const lineId = lineIdFromPath(request.nextUrl.pathname);
  const manualId = await manualIdFromBody(request);
  if (!Number.isFinite(lineId) || lineId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid line id' }, { status: 400 });
  }
  if (!Number.isFinite(manualId) || manualId <= 0) {
    return NextResponse.json({ ok: false, error: 'manualId is required' }, { status: 400 });
  }

  try {
    const manual = await setManualSkuCatalogId(manualId, null);
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
