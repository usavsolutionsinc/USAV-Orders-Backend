import { NextRequest, NextResponse } from 'next/server';
import {
  getSkuCatalogBySku,
  getSkuCatalogList,
  upsertSkuCatalog,
} from '@/lib/neon/sku-catalog-queries';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { SkuCatalogCreateBody } from '@/lib/schemas/sku-catalog';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

const ROUTE_SKU_CATALOG_POST = 'sku-catalog.post';

/**
 * GET /api/sku-catalog — Paginated SKU catalog list with platform/manual/QC counts.
 */
export const GET = withAuth(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q') || '';
    const limit = Math.max(1, Math.min(500, Number(searchParams.get('limit') || 100)));
    const offset = Math.max(0, Number(searchParams.get('offset') || 0));
    const sort = searchParams.get('sort') || 'az';
    const dir = searchParams.get('dir') || 'asc';
    const ecwidOnly = searchParams.get('ecwidOnly') === 'true';

    const { items, total } = await getSkuCatalogList({ q, limit, offset, sort, dir, ecwidOnly });

    return NextResponse.json({ success: true, items, total });
  } catch (error: any) {
    console.error('Error in GET /api/sku-catalog:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch SKU catalog' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.view' });

/**
 * POST /api/sku-catalog — Create a new SKU catalog entry.
 *
 * Body: { sku, productTitle, category?, upc?, ean?, imageUrl?, isActive?, idempotencyKey? }
 *
 * `sku` is the natural unique key. A retried create with the same
 * `Idempotency-Key` (header or body) replays the original 201 instead of
 * colliding; a genuinely different request for an already-active SKU is a 409.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(SkuCatalogCreateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    // ─── Idempotency replay ─────────────────────────────────────────────────
    const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, idemKey, ROUTE_SKU_CATALOG_POST);
      if (hit) {
        return NextResponse.json(hit.response_body, { status: hit.status_code });
      }
    }

    // True create semantics: reject if an active row already owns this sku.
    const existing = await getSkuCatalogBySku(parsed.sku);
    if (existing && existing.is_active) {
      return NextResponse.json(
        { success: false, error: 'A SKU catalog entry with that sku already exists', id: existing.id },
        { status: 409 },
      );
    }

    // upsert reactivates a previously soft-deleted row or inserts a new one.
    const catalog = await upsertSkuCatalog({
      sku: parsed.sku,
      productTitle: parsed.productTitle,
      category: parsed.category ?? null,
      upc: parsed.upc ?? null,
      ean: parsed.ean ?? null,
      imageUrl: parsed.imageUrl ?? null,
      isActive: parsed.isActive ?? true,
      lifecycleStatus: parsed.lifecycleStatus ?? null,
      reorderThreshold: parsed.reorderThreshold ?? null,
      lastKnownCostCents: parsed.lastKnownCostCents ?? null,
      sourcingNotes: parsed.sourcingNotes ?? null,
      replenishTargetCents: parsed.replenishTargetCents ?? null,
    });

    await recordAudit(pool, ctx, req, {
      source: 'sku-catalog-api',
      action: AUDIT_ACTION.SKU_CATALOG_CREATE,
      entityType: AUDIT_ENTITY.SKU,
      entityId: catalog.id,
      before: existing ? { ...existing } : null,
      after: { ...catalog },
    });

    const responseBody = { success: true, catalog };
    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
        idempotencyKey: idemKey,
        route: ROUTE_SKU_CATALOG_POST,
        staffId: ctx.staffId,
        statusCode: 201,
        responseBody,
      });
    }

    return NextResponse.json(responseBody, { status: 201 });
  } catch (error: any) {
    if (error?.code === '23505' || /unique/i.test(error?.message || '')) {
      return NextResponse.json(
        { success: false, error: 'A SKU catalog entry with that sku already exists' },
        { status: 409 },
      );
    }
    console.error('Error in POST /api/sku-catalog:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create SKU catalog entry' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.manage' });
