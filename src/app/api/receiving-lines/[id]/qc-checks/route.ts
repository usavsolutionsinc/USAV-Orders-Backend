import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import {
  createQcCheck,
  updateQcCheck,
  deleteQcCheck,
} from '@/lib/neon/sku-catalog-queries';
import {
  resolveLineCatalog,
  resolveOrCreateLineCatalog,
} from '@/lib/receiving/line-catalog';
import { parseBody } from '@/lib/schemas/parse';
import { QcCheckCreateBody, QcCheckUpdateBody, QcCheckDeleteBody } from '@/lib/schemas/qc-checks';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

/**
 * Tech-facing checklist step editing, scoped to a receiving line.
 *
 * Mirrors /api/sku-catalog/[id]/qc-checks but resolves the catalog id from the
 * line and is gated on `tech.qc_pass` (not `sku_stock.manage`) so testers can
 * curate the checklist from the testing screen. POST creates the catalog row on
 * demand when the SKU isn't catalogued yet.
 */
function lineIdFromPath(pathname: string): number {
  const segments = pathname.split('/').filter(Boolean);
  // .../api/receiving-lines/[id]/qc-checks → id is segments[-2]
  return Number(segments[segments.length - 2]);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Confirm a step belongs to the line's resolved catalog before mutating it. */
async function stepBelongsToCatalog(stepId: number, skuCatalogId: number): Promise<boolean> {
  const res = await pool.query<{ sku_catalog_id: number | null }>(
    `SELECT sku_catalog_id FROM qc_check_templates WHERE id = $1`,
    [stepId],
  );
  if (res.rows.length === 0) return false;
  // Per-SKU steps must match; category-shared steps (sku_catalog_id IS NULL) are
  // global templates and are not editable from a single line's screen.
  return res.rows[0].sku_catalog_id === skuCatalogId;
}

export const POST = withAuth(async (request) => {
  const lineId = lineIdFromPath(request.nextUrl.pathname);
  if (!Number.isFinite(lineId) || lineId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid line id' }, { status: 400 });
  }
  const raw = await readBody(request);
  const parsed = parseBody(QcCheckCreateBody, raw);
  if (parsed instanceof NextResponse) return parsed;

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
    const check = await createQcCheck({
      skuCatalogId: resolved.skuCatalogId,
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
    return NextResponse.json({ ok: true, skuCatalogId: resolved.skuCatalogId, check });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to create step';
    console.error('[POST /api/receiving-lines/[id]/qc-checks] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, {
  permission: 'tech.qc_pass',
  audit: {
    source: 'tech',
    action: AUDIT_ACTION.QC_CHECK_CREATE,
    entityType: AUDIT_ENTITY.QC_CHECK_TEMPLATE,
    entityId: ({ response }) => (response as { check?: { id?: number } })?.check?.id ?? null,
  },
});

export const PUT = withAuth(async (request) => {
  const lineId = lineIdFromPath(request.nextUrl.pathname);
  if (!Number.isFinite(lineId) || lineId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid line id' }, { status: 400 });
  }
  const raw = await readBody(request);
  const parsed = parseBody(QcCheckUpdateBody, raw);
  if (parsed instanceof NextResponse) return parsed;
  const checkId = parsed.checkId;

  try {
    const resolved = await resolveLineCatalog(lineId);
    if (!resolved?.skuCatalogId) {
      return NextResponse.json({ ok: false, error: 'no catalog for this line' }, { status: 409 });
    }
    if (!(await stepBelongsToCatalog(checkId, resolved.skuCatalogId))) {
      return NextResponse.json({ ok: false, error: 'step not on this SKU' }, { status: 403 });
    }
    const updated = await updateQcCheck(checkId, {
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
      return NextResponse.json({ ok: false, error: 'no changes or not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, check: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to update step';
    console.error('[PUT /api/receiving-lines/[id]/qc-checks] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, {
  permission: 'tech.qc_pass',
  audit: {
    source: 'tech',
    action: AUDIT_ACTION.QC_CHECK_UPDATE,
    entityType: AUDIT_ENTITY.QC_CHECK_TEMPLATE,
    entityId: ({ body }) => (body as { checkId?: number })?.checkId ?? null,
  },
});

export const DELETE = withAuth(async (request) => {
  const lineId = lineIdFromPath(request.nextUrl.pathname);
  if (!Number.isFinite(lineId) || lineId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid line id' }, { status: 400 });
  }
  const raw = await readBody(request);
  const parsed = parseBody(QcCheckDeleteBody, raw);
  if (parsed instanceof NextResponse) return parsed;
  const checkId = parsed.checkId;

  try {
    const resolved = await resolveLineCatalog(lineId);
    if (!resolved?.skuCatalogId) {
      return NextResponse.json({ ok: false, error: 'no catalog for this line' }, { status: 409 });
    }
    if (!(await stepBelongsToCatalog(checkId, resolved.skuCatalogId))) {
      return NextResponse.json({ ok: false, error: 'step not on this SKU' }, { status: 403 });
    }
    const deleted = await deleteQcCheck(checkId);
    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to delete step';
    console.error('[DELETE /api/receiving-lines/[id]/qc-checks] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, {
  permission: 'tech.qc_pass',
  audit: {
    source: 'tech',
    action: AUDIT_ACTION.QC_CHECK_DELETE,
    entityType: AUDIT_ENTITY.QC_CHECK_TEMPLATE,
    entityId: ({ body }) => (body as { checkId?: number })?.checkId ?? null,
  },
});
