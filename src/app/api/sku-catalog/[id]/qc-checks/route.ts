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

const ROUTE_QC_CHECKS_POST = 'sku-catalog.qc-checks.post';

/** withAuth doesn't forward Next's params — resolve [id] from the path.
 *  .../api/sku-catalog/[id]/qc-checks → id is segments[-2]. */
function skuIdFromPath(pathname: string): number {
  const segments = pathname.split('/').filter(Boolean);
  return Number(segments[segments.length - 2]);
}

/** Fetch one step (for before-state audit + 404). */
async function getQcCheckById(checkId: number): Promise<Record<string, unknown> | null> {
  const r = await pool.query(`SELECT * FROM qc_check_templates WHERE id = $1`, [checkId]);
  return r.rows[0] ?? null;
}

/**
 * GET /api/sku-catalog/[id]/qc-checks — Read the QC checklist for a SKU.
 * Returns the catalog row (header) plus its QC steps, including category-scoped
 * templates. `?publishedOnly=1` returns only published steps (execution view).
 */
export const GET = withAuth(async (req: NextRequest) => {
  try {
    const skuCatalogId = skuIdFromPath(req.nextUrl.pathname);
    if (!Number.isFinite(skuCatalogId) || skuCatalogId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const catalog = await getSkuCatalogById(skuCatalogId);
    if (!catalog) {
      return NextResponse.json({ success: false, error: 'SKU not found' }, { status: 404 });
    }

    const publishedOnly = req.nextUrl.searchParams.get('publishedOnly') === '1';
    const checks = await getQcChecks(skuCatalogId, catalog.category, { publishedOnly });
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

    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(QcCheckCreateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const idemKey = readIdempotencyKey(req, parsed.idempotencyKey ?? null);
    if (idemKey) {
      const hit = await getApiIdempotencyResponse(pool, idemKey, ROUTE_QC_CHECKS_POST);
      if (hit) return NextResponse.json(hit.response_body, { status: hit.status_code });
    }

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
    });

    await recordAudit(pool, ctx, req, {
      source: 'sku-catalog-api',
      action: AUDIT_ACTION.QC_CHECK_CREATE,
      entityType: AUDIT_ENTITY.QC_CHECK_TEMPLATE,
      entityId: check.id,
      before: null,
      after: { ...check },
      extra: { sku_catalog_id: skuCatalogId },
    });

    const responseBody = { success: true, check };
    if (idemKey) {
      await saveApiIdempotencyResponse(pool, {
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

    const before = await getQcCheckById(parsed.checkId);
    if (!before) {
      return NextResponse.json({ success: false, error: 'QC check not found' }, { status: 404 });
    }

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
    });
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

    const before = await getQcCheckById(parsed.checkId);
    const deleted = await deleteQcCheck(parsed.checkId);

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
    return NextResponse.json({ success: true, deleted });
  } catch (error: any) {
    console.error('Error in DELETE /api/sku-catalog/[id]/qc-checks:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete QC check' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.manage' });
