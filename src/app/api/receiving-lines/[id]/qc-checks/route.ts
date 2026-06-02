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
  const body = await readBody(request);
  const stepLabel = typeof body.stepLabel === 'string' ? body.stepLabel.trim() : '';
  if (!stepLabel) {
    return NextResponse.json({ ok: false, error: 'stepLabel is required' }, { status: 400 });
  }
  const stepType = typeof body.stepType === 'string' ? body.stepType : undefined;
  const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : undefined;

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
      stepLabel,
      stepType,
      sortOrder,
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
    action: 'qc_check.create',
    entityType: 'qc_check_template',
    entityId: ({ response }) => (response as { check?: { id?: number } })?.check?.id ?? null,
  },
});

export const PUT = withAuth(async (request) => {
  const lineId = lineIdFromPath(request.nextUrl.pathname);
  if (!Number.isFinite(lineId) || lineId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid line id' }, { status: 400 });
  }
  const body = await readBody(request);
  const checkId = Number(body.checkId);
  if (!Number.isFinite(checkId) || checkId <= 0) {
    return NextResponse.json({ ok: false, error: 'checkId is required' }, { status: 400 });
  }
  const updates: { stepLabel?: string; stepType?: string; sortOrder?: number } = {};
  if (typeof body.stepLabel === 'string') updates.stepLabel = body.stepLabel.trim();
  if (typeof body.stepType === 'string') updates.stepType = body.stepType;
  if (Number.isFinite(Number(body.sortOrder))) updates.sortOrder = Number(body.sortOrder);

  try {
    const resolved = await resolveLineCatalog(lineId);
    if (!resolved?.skuCatalogId) {
      return NextResponse.json({ ok: false, error: 'no catalog for this line' }, { status: 409 });
    }
    if (!(await stepBelongsToCatalog(checkId, resolved.skuCatalogId))) {
      return NextResponse.json({ ok: false, error: 'step not on this SKU' }, { status: 403 });
    }
    const updated = await updateQcCheck(checkId, updates);
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
    action: 'qc_check.update',
    entityType: 'qc_check_template',
    entityId: ({ body }) => (body as { checkId?: number })?.checkId ?? null,
  },
});

export const DELETE = withAuth(async (request) => {
  const lineId = lineIdFromPath(request.nextUrl.pathname);
  if (!Number.isFinite(lineId) || lineId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid line id' }, { status: 400 });
  }
  const body = await readBody(request);
  const checkId = Number(body.checkId);
  if (!Number.isFinite(checkId) || checkId <= 0) {
    return NextResponse.json({ ok: false, error: 'checkId is required' }, { status: 400 });
  }

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
    action: 'qc_check.delete',
    entityType: 'qc_check_template',
    entityId: ({ body }) => (body as { checkId?: number })?.checkId ?? null,
  },
});
