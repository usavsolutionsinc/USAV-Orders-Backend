import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { SkuRelationshipCreateBody } from '@/lib/schemas/sku-relationship';
import { getSkuCatalogById } from '@/lib/neon/sku-catalog-queries';
import {
  createRelationship,
  findRelationship,
  isDescendant,
} from '@/lib/neon/sku-relationship-queries';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

const ROUTE_SKU_RELATIONSHIP_POST = 'sku-relationship.post';

/**
 * POST /api/sku-catalog/graph/relationships — Add a parent→child SKU edge.
 *
 * Body: { parentSkuId, childSkuId, qty?, notes?, idempotencyKey? }
 *
 * Validation:
 *  - both SKUs must exist (404)
 *  - no self-edge (caught by the Zod schema + DB CHECK)
 *  - no duplicate edge (409)
 *  - no cycle: child must not already be an ancestor of parent (409)
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(SkuRelationshipCreateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    // ─── Idempotency replay ─────────────────────────────────────────────────
    const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, idemKey, ROUTE_SKU_RELATIONSHIP_POST);
      if (hit) {
        return NextResponse.json(hit.response_body, { status: hit.status_code });
      }
    }

    // Both endpoints must be real catalog rows owned by this org. The
    // org-scoped lookup 404s if either id belongs to another tenant, so an
    // edge can only ever be created between this org's own SKUs.
    const [parent, child] = await Promise.all([
      getSkuCatalogById(parsed.parentSkuId, ctx.organizationId),
      getSkuCatalogById(parsed.childSkuId, ctx.organizationId),
    ]);
    if (!parent) {
      return NextResponse.json({ success: false, error: 'parentSkuId not found' }, { status: 404 });
    }
    if (!child) {
      return NextResponse.json({ success: false, error: 'childSkuId not found' }, { status: 404 });
    }

    // No duplicate edge.
    const existing = await findRelationship(parsed.parentSkuId, parsed.childSkuId, ctx.organizationId);
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'That relationship already exists', id: existing.id },
        { status: 409 },
      );
    }

    // Cycle guard: adding parent→child would close a loop if `parent` is already
    // reachable underneath `child`.
    if (await isDescendant(parsed.childSkuId, parsed.parentSkuId, ctx.organizationId)) {
      return NextResponse.json(
        { success: false, error: 'That connection would create a cycle (child is an ancestor of parent)' },
        { status: 409 },
      );
    }

    const relationship = await createRelationship({
      parentSkuId: parsed.parentSkuId,
      childSkuId: parsed.childSkuId,
      qty: parsed.qty ?? 1,
      notes: parsed.notes ?? null,
    }, ctx.organizationId);

    await recordAudit(pool, ctx, req, {
      source: 'sku-graph-api',
      action: AUDIT_ACTION.SKU_RELATIONSHIP_CREATE,
      entityType: AUDIT_ENTITY.SKU_RELATIONSHIP,
      entityId: relationship.id,
      before: null,
      after: { ...relationship },
    });

    const responseBody = { success: true, relationship };
    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
        idempotencyKey: idemKey,
        route: ROUTE_SKU_RELATIONSHIP_POST,
        staffId: ctx.staffId,
        statusCode: 201,
        responseBody,
      });
    }

    return NextResponse.json(responseBody, { status: 201 });
  } catch (error: any) {
    // Unique (parent, child) collision under a race.
    if (error?.code === '23505' || /unique/i.test(error?.message || '')) {
      return NextResponse.json(
        { success: false, error: 'That relationship already exists' },
        { status: 409 },
      );
    }
    console.error('Error in POST /api/sku-catalog/graph/relationships:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create relationship' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.manage' });
