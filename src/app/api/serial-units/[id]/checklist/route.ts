import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { upsertVerification } from '@/lib/neon/sku-catalog-queries';

/**
 * Per-unit testing checklist (execution layer).
 *
 * The checklist *template* is per-SKU and authored in the SKU catalog admin
 * (qc_check_templates). This endpoint resolves the unit's SKU → its checklist
 * steps, and records/reads the tester's per-step results in tech_verifications
 * (source_kind='serial_unit', source_row_id=<serial_units.id>, step_id=<qc
 * step id>). Each result carries the staff id who completed it.
 *
 * No verdict gating yet — this is the record-and-track layer. The Pass+Print
 * verdict (testing_results) stays independent for now.
 */

const SOURCE_KIND = 'serial_unit';
const STEP_TYPE = 'QC';

function unitIdFromPath(pathname: string): number {
  const segments = pathname.split('/').filter(Boolean);
  // .../api/serial-units/[id]/checklist → id is segments[-2]
  return Number(segments[segments.length - 2]);
}

/**
 * GET — the unit's checklist: every template step merged with this unit's
 * recorded result (passed / who / when), plus a completion tally.
 */
export const GET = withAuth(async (request) => {
  const serialUnitId = unitIdFromPath(request.nextUrl.pathname);
  if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid serial_unit id' }, { status: 400 });
  }

  try {
    const unit = await pool.query<{ sku_catalog_id: number | null; category: string | null }>(
      `SELECT su.sku_catalog_id, sc.category
         FROM serial_units su
    LEFT JOIN sku_catalog sc ON sc.id = su.sku_catalog_id
        WHERE su.id = $1`,
      [serialUnitId],
    );
    if (unit.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'unit not found' }, { status: 404 });
    }
    const { sku_catalog_id, category } = unit.rows[0];

    // No catalog row → no checklist to resolve. Return an empty (but valid) set.
    if (sku_catalog_id == null) {
      return NextResponse.json({ ok: true, steps: [], progress: { completed: 0, total: 0 } });
    }

    const steps = await pool.query(
      `SELECT qc.id            AS step_id,
              qc.step_label,
              qc.step_type,
              qc.sort_order,
              tv.passed,
              tv.verified_by,
              s.name           AS verified_by_name,
              tv.verified_at,
              tv.notes
         FROM qc_check_templates qc
    LEFT JOIN tech_verifications tv
           ON tv.step_id       = qc.id
          AND tv.step_type     = $2
          AND tv.source_kind   = $3
          AND tv.source_row_id = $1
    LEFT JOIN staff s ON s.id = tv.verified_by
        WHERE qc.sku_catalog_id = $4
           OR ($5::text IS NOT NULL AND qc.category = $5 AND qc.sku_catalog_id IS NULL)
     ORDER BY qc.sort_order, qc.id`,
      [serialUnitId, STEP_TYPE, SOURCE_KIND, sku_catalog_id, category],
    );

    const completed = steps.rows.filter((r) => r.passed != null).length;
    return NextResponse.json({
      ok: true,
      steps: steps.rows,
      progress: { completed, total: steps.rows.length },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to load checklist';
    console.error('[GET /api/serial-units/[id]/checklist] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'tech.qc_pass' });

/**
 * POST — record (or re-mark) one step result for this unit.
 * Body: { stepId: number, passed?: boolean, notes?: string }
 */
export const POST = withAuth(async (request, ctx) => {
  const serialUnitId = unitIdFromPath(request.nextUrl.pathname);
  if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid serial_unit id' }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    /* empty body handled below */
  }

  const stepId = Number(body.stepId);
  if (!Number.isFinite(stepId) || stepId <= 0) {
    return NextResponse.json({ ok: false, error: 'stepId is required' }, { status: 400 });
  }
  const passed = body.passed === undefined ? true : Boolean(body.passed);
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) || null : null;
  const verifiedBy = Number(ctx.staffId);
  if (!Number.isFinite(verifiedBy) || verifiedBy <= 0) {
    return NextResponse.json({ ok: false, error: 'no staff identity on request' }, { status: 401 });
  }

  try {
    // tech_verifications.sku_catalog_id is NOT NULL — resolve it from the unit.
    const unit = await pool.query<{ sku_catalog_id: number | null }>(
      `SELECT sku_catalog_id FROM serial_units WHERE id = $1`,
      [serialUnitId],
    );
    if (unit.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'unit not found' }, { status: 404 });
    }
    const skuCatalogId = unit.rows[0].sku_catalog_id;
    if (skuCatalogId == null) {
      return NextResponse.json(
        { ok: false, error: 'unit has no SKU catalog row — cannot record checklist' },
        { status: 409 },
      );
    }

    const verification = await upsertVerification({
      sourceKind: SOURCE_KIND,
      sourceRowId: serialUnitId,
      skuCatalogId,
      stepType: STEP_TYPE,
      stepId,
      passed,
      verifiedBy,
      notes,
    });

    return NextResponse.json({ ok: true, verification });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to record step';
    console.error('[POST /api/serial-units/[id]/checklist] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'tech.qc_pass' });
