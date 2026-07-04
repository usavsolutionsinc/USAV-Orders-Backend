import { NextRequest, NextResponse } from 'next/server';
import {
  createKitPart,
  updateKitPart,
  deleteKitPart,
  getKitParts,
  getSkuCatalogById,
} from '@/lib/neon/sku-catalog-queries';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { KitPartCreateBody, KitPartUpdateBody, KitPartDeleteBody } from '@/lib/schemas/kit-parts';
import {
  getApiIdempotencyResponse,
  readIdempotencyKey,
  saveApiIdempotencyResponse,
} from '@/lib/api-idempotency';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { CACHE_TAGS } from '@/lib/cache/tags';

const ROUTE_KIT_PARTS_POST = 'sku-catalog.kit-parts.post';

/** withAuth doesn't forward Next's params — resolve [id] from the path.
 *  .../api/sku-catalog/[id]/kit-parts → id is segments[-2]. */
function skuIdFromPath(pathname: string): number {
  const segments = pathname.split('/').filter(Boolean);
  return Number(segments[segments.length - 2]);
}

/** Fetch one part (for before-state audit + 404) — tenant-scoped so a cross-org
 *  partId resolves to null (→ 404, never a 403). */
async function getKitPartById(partId: number, orgId: OrgId): Promise<Record<string, unknown> | null> {
  const r = await tenantQuery(
    orgId,
    `SELECT * FROM sku_kit_parts WHERE id = $1 AND organization_id = $2`,
    [partId, orgId],
  );
  return r.rows[0] ?? null;
}

/**
 * GET /api/sku-catalog/[id]/kit-parts — Read the kit-parts BOM for a SKU.
 * Returns the catalog row (header) plus ALL its kit parts (every condition —
 * the authoring view is not condition-gated; condition gating happens at pack
 * time via /api/get-title-by-sku).
 */
export const GET = withAuth(async (req: NextRequest, ctx) => {
  try {
    const skuCatalogId = skuIdFromPath(req.nextUrl.pathname);
    if (!Number.isFinite(skuCatalogId) || skuCatalogId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    // Org-scoped lookup — a SKU owned by another org resolves to null → 404.
    const catalog = await getSkuCatalogById(skuCatalogId, ctx.organizationId);
    if (!catalog) {
      return NextResponse.json({ success: false, error: 'SKU not found' }, { status: 404 });
    }

    // condition = null ⇒ every part (the editor shows the full BOM regardless of
    // which condition grades a row is gated to). Org-scoped.
    const parts = await getKitParts(skuCatalogId, null, ctx.organizationId);
    return NextResponse.json({ success: true, catalog, parts });
  } catch (error: any) {
    console.error('Error in GET /api/sku-catalog/[id]/kit-parts:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to load kit parts' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.view' });

/**
 * POST /api/sku-catalog/[id]/kit-parts — Create a kit part (BOM row).
 * Idempotent via Idempotency-Key (header or body).
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const skuCatalogId = skuIdFromPath(req.nextUrl.pathname);
    if (!Number.isFinite(skuCatalogId) || skuCatalogId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    // Org-ownership precheck on the parent SKU — a part can only be created under
    // a catalog row this org owns (cross-org → 404, never 403).
    const parent = await getSkuCatalogById(skuCatalogId, ctx.organizationId);
    if (!parent) {
      return NextResponse.json({ success: false, error: 'SKU not found' }, { status: 404 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(KitPartCreateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, ctx.organizationId, idemKey, ROUTE_KIT_PARTS_POST);
      if (hit) return NextResponse.json(hit.response_body, { status: hit.status_code });
    }

    // Thread orgId so the INSERT runs inside withTenantTransaction and stamps
    // organization_id = caller's org (without it the table default resolves to
    // the GUC, which is unset on the raw pool → wrong-tenant write).
    const part = await createKitPart({
      skuCatalogId,
      componentName: parsed.componentName,
      componentType: parsed.componentType,
      qtyRequired: parsed.qtyRequired,
      requiredFor: parsed.requiredFor ?? null,
      isCritical: parsed.isCritical,
      sortOrder: parsed.sortOrder,
    }, ctx.organizationId);

    await recordAudit(pool, ctx, req, {
      source: 'sku-catalog-api',
      action: AUDIT_ACTION.KIT_PART_CREATE,
      entityType: AUDIT_ENTITY.KIT_PART_TEMPLATE,
      entityId: part.id,
      before: null,
      after: { ...part },
      extra: { sku_catalog_id: skuCatalogId },
    });

    // Bust the cached get-title-by-sku bundle (tagged sku-kit-parts) for this org.
    await invalidateCacheTags(ctx.organizationId, [CACHE_TAGS.skuKitParts]);

    const responseBody = { success: true, part };
    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
        orgId: ctx.organizationId,
        idempotencyKey: idemKey,
        route: ROUTE_KIT_PARTS_POST,
        staffId: ctx.staffId,
        statusCode: 201,
        responseBody,
      });
    }
    return NextResponse.json(responseBody, { status: 201 });
  } catch (error: any) {
    console.error('Error in POST /api/sku-catalog/[id]/kit-parts:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create kit part' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.manage' });

/**
 * PUT /api/sku-catalog/[id]/kit-parts — Update a kit part by partId in body.
 */
export const PUT = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(KitPartUpdateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    // Org-scoped before-state — a cross-org partId is invisible (→ 404), so the
    // write below can never touch another tenant's part.
    const before = await getKitPartById(parsed.partId, ctx.organizationId);
    if (!before) {
      return NextResponse.json({ success: false, error: 'Kit part not found' }, { status: 404 });
    }

    const updated = await updateKitPart(parsed.partId, {
      componentName: parsed.componentName,
      componentType: parsed.componentType,
      qtyRequired: parsed.qtyRequired,
      requiredFor: parsed.requiredFor,
      isCritical: parsed.isCritical,
      sortOrder: parsed.sortOrder,
    }, ctx.organizationId);
    if (!updated) {
      return NextResponse.json({ success: false, error: 'No changes' }, { status: 400 });
    }

    await recordAudit(pool, ctx, req, {
      source: 'sku-catalog-api',
      action: AUDIT_ACTION.KIT_PART_UPDATE,
      entityType: AUDIT_ENTITY.KIT_PART_TEMPLATE,
      entityId: parsed.partId,
      before,
      after: { ...updated },
    });

    await invalidateCacheTags(ctx.organizationId, [CACHE_TAGS.skuKitParts]);

    return NextResponse.json({ success: true, part: updated });
  } catch (error: any) {
    console.error('Error in PUT /api/sku-catalog/[id]/kit-parts:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update kit part' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.manage' });

/**
 * DELETE /api/sku-catalog/[id]/kit-parts — Delete a kit part by partId in body.
 */
export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(KitPartDeleteBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    // Org-ownership gate: only delete a part this org owns. A cross-org (or
    // missing) partId resolves to null here, so deleteKitPart is never reached
    // for another tenant's row (→ 404).
    const before = await getKitPartById(parsed.partId, ctx.organizationId);
    if (!before) {
      return NextResponse.json({ success: false, error: 'Kit part not found' }, { status: 404 });
    }
    const deleted = await deleteKitPart(parsed.partId, ctx.organizationId);

    if (deleted && before) {
      await recordAudit(pool, ctx, req, {
        source: 'sku-catalog-api',
        action: AUDIT_ACTION.KIT_PART_DELETE,
        entityType: AUDIT_ENTITY.KIT_PART_TEMPLATE,
        entityId: parsed.partId,
        before,
        after: null,
      });
    }
    await invalidateCacheTags(ctx.organizationId, [CACHE_TAGS.skuKitParts]);
    return NextResponse.json({ success: true, deleted });
  } catch (error: any) {
    console.error('Error in DELETE /api/sku-catalog/[id]/kit-parts:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete kit part' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.manage' });
