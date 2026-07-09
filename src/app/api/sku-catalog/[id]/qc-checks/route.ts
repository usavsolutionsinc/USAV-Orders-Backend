import { NextRequest, NextResponse } from 'next/server';
import {
  createQcCheck,
  updateQcCheck,
  deleteQcCheck,
  getQcChecks,
  getSkuCatalogById,
} from '@/lib/neon/sku-catalog-queries';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { QcCheckCreateBody, QcCheckUpdateBody, QcCheckDeleteBody } from '@/lib/schemas/qc-checks';
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

const ROUTE_QC_CHECKS_POST = 'sku-catalog.qc-checks.post';

/** withAuth doesn't forward Next's params — resolve [id] from the path.
 *  .../api/sku-catalog/[id]/qc-checks → id is segments[-2]. */
function skuIdFromPath(pathname: string): number {
  const segments = pathname.split('/').filter(Boolean);
  return Number(segments[segments.length - 2]);
}

/** Fetch one step (for before-state audit + 404) — tenant-scoped so a
 *  cross-org checkId resolves to null (→ 404, never a 403). */
async function getQcCheckById(checkId: number, orgId: OrgId): Promise<Record<string, unknown> | null> {
  const r = await tenantQuery(
    orgId,
    `SELECT * FROM qc_check_templates WHERE id = $1 AND organization_id = $2`,
    [checkId, orgId],
  );
  return r.rows[0] ?? null;
}

/**
 * GET /api/sku-catalog/[id]/qc-checks — Read the QC checklist for a SKU.
 * Returns the catalog row (header) plus its QC steps, including category-scoped
 * templates. `?publishedOnly=1` returns only published steps (execution view).
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

    const publishedOnly = req.nextUrl.searchParams.get('publishedOnly') === '1';
    // Thread orgId so the category-default branch (category = $2 AND
    // sku_catalog_id IS NULL) is org-scoped — without it, the shared query runs
    // on the raw pool and a shared free-text category string leaks every other
    // tenant's category-level qc_check_templates rows.
    const checks = await getQcChecks(
      skuCatalogId,
      catalog.category,
      { publishedOnly },
      ctx.organizationId,
    );
    return NextResponse.json({ success: true, catalog, checks });
  } catch (error: any) {
    console.error('Error in GET /api/sku-catalog/[id]/qc-checks:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to load QC checks' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.view' });

/**
 * POST /api/sku-catalog/[id]/qc-checks — Create a QC check step.
 * Idempotent via Idempotency-Key (header or body). Persists the structured-value
 * config (value_kind/unit/enum, pass band) when provided.
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
  try {
    const skuCatalogId = skuIdFromPath(req.nextUrl.pathname);
    if (!Number.isFinite(skuCatalogId) || skuCatalogId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    // Org-ownership precheck on the parent SKU — a step can only be created
    // under a catalog row this org owns (cross-org → 404, never 403).
    const parent = await getSkuCatalogById(skuCatalogId, ctx.organizationId);
    if (!parent) {
      return NextResponse.json({ success: false, error: 'SKU not found' }, { status: 404 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(QcCheckCreateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, ctx.organizationId, idemKey, ROUTE_QC_CHECKS_POST);
      if (hit) return NextResponse.json(hit.response_body, { status: hit.status_code });
    }

    // Thread orgId so the INSERT runs inside withTenantTransaction and stamps
    // organization_id = caller's org. Without it the shared helper runs on the
    // raw pool with the GUC unset, so the table default resolves to the USAV
    // org and a non-USAV tenant's QC row is silently written under USAV.
    const check = await createQcCheck({
      skuCatalogId,
      stepLabel: parsed.stepLabel,
      stepType: parsed.stepType,
      sortOrder: parsed.sortOrder,
      status: parsed.status,
      valueKind: parsed.valueKind ?? null,
      valueUnit: parsed.valueUnit ?? null,
      valueEnum: parsed.valueEnum ?? null,
      passMin: parsed.passMin ?? null,
      passMax: parsed.passMax ?? null,
      failureModeId: parsed.failureModeId ?? null,
    }, ctx.organizationId);

    await recordAudit(pool, ctx, req, {
      source: 'sku-catalog-api',
      action: AUDIT_ACTION.QC_CHECK_CREATE,
      entityType: AUDIT_ENTITY.QC_CHECK_TEMPLATE,
      entityId: check.id,
      before: null,
      after: { ...check },
      extra: { sku_catalog_id: skuCatalogId },
    });

    await invalidateCacheTags(ctx.organizationId, [CACHE_TAGS.qcChecks]);
    const responseBody = { success: true, check };
    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
        orgId: ctx.organizationId,
        idempotencyKey: idemKey,
        route: ROUTE_QC_CHECKS_POST,
        staffId: ctx.staffId,
        statusCode: 201,
        responseBody,
      });
    }
    return NextResponse.json(responseBody, { status: 201 });
  } catch (error: any) {
    console.error('Error in POST /api/sku-catalog/[id]/qc-checks:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create QC check' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.manage' });

/**
 * PUT /api/sku-catalog/[id]/qc-checks — Update a QC check by checkId in body.
 * A status-only change is audited as a publish/unpublish; otherwise as an update.
 */
export const PUT = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(QcCheckUpdateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    // Org-scoped before-state — a cross-org checkId is invisible (→ 404),
    // so the write below can never touch another tenant's step.
    const before = await getQcCheckById(parsed.checkId, ctx.organizationId);
    if (!before) {
      return NextResponse.json({ success: false, error: 'QC check not found' }, { status: 404 });
    }

    // Thread orgId so the UPDATE carries an explicit organization_id predicate
    // and runs inside withTenantTransaction (a foreign-org checkId updates 0
    // rows even if the pre-gate were bypassed).
    const updated = await updateQcCheck(parsed.checkId, {
      stepLabel: parsed.stepLabel,
      stepType: parsed.stepType,
      sortOrder: parsed.sortOrder,
      status: parsed.status,
      valueKind: parsed.valueKind,
      valueUnit: parsed.valueUnit,
      valueEnum: parsed.valueEnum,
      passMin: parsed.passMin,
      passMax: parsed.passMax,
      failureModeId: parsed.failureModeId,
    }, ctx.organizationId);
    if (!updated) {
      return NextResponse.json({ success: false, error: 'No changes' }, { status: 400 });
    }

    // Status-only edit → publish/unpublish; anything else → generic update.
    const onlyStatus =
      parsed.status !== undefined &&
      parsed.stepLabel === undefined &&
      parsed.stepType === undefined &&
      parsed.sortOrder === undefined &&
      parsed.valueKind === undefined &&
      parsed.valueUnit === undefined &&
      parsed.valueEnum === undefined &&
      parsed.passMin === undefined &&
      parsed.passMax === undefined &&
      parsed.failureModeId === undefined;

    await recordAudit(pool, ctx, req, {
      source: 'sku-catalog-api',
      action: onlyStatus ? AUDIT_ACTION.QC_CHECK_PUBLISH : AUDIT_ACTION.QC_CHECK_UPDATE,
      entityType: AUDIT_ENTITY.QC_CHECK_TEMPLATE,
      entityId: parsed.checkId,
      before,
      after: { ...updated },
    });

    await invalidateCacheTags(ctx.organizationId, [CACHE_TAGS.qcChecks]);
    return NextResponse.json({ success: true, check: updated });
  } catch (error: any) {
    console.error('Error in PUT /api/sku-catalog/[id]/qc-checks:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update QC check' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.manage' });

/**
 * DELETE /api/sku-catalog/[id]/qc-checks — Delete a QC check by checkId in body.
 */
export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(QcCheckDeleteBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    // Org-ownership gate: only delete a step this org owns. A cross-org (or
    // missing) checkId resolves to null here, so deleteQcCheck — which is not
    // itself org-scoped — is never reached for another tenant's row (→ 404).
    const before = await getQcCheckById(parsed.checkId, ctx.organizationId);
    if (!before) {
      return NextResponse.json({ success: false, error: 'QC check not found' }, { status: 404 });
    }
    // Thread orgId so the DELETE carries an explicit organization_id predicate
    // and runs inside withTenantTransaction (defense-in-depth vs the pre-gate).
    const deleted = await deleteQcCheck(parsed.checkId, ctx.organizationId);

    if (deleted && before) {
      await recordAudit(pool, ctx, req, {
        source: 'sku-catalog-api',
        action: AUDIT_ACTION.QC_CHECK_DELETE,
        entityType: AUDIT_ENTITY.QC_CHECK_TEMPLATE,
        entityId: parsed.checkId,
        before,
        after: null,
      });
    }
    await invalidateCacheTags(ctx.organizationId, [CACHE_TAGS.qcChecks]);
    return NextResponse.json({ success: true, deleted });
  } catch (error: any) {
    console.error('Error in DELETE /api/sku-catalog/[id]/qc-checks:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete QC check' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.manage' });
