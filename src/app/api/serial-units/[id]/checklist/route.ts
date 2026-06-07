import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { upsertVerification, deriveStepPassed } from '@/lib/neon/sku-catalog-queries';
import { tagUnitFailure } from '@/lib/neon/failure-modes-queries';
import { parseBody } from '@/lib/schemas/parse';
import { QcResultBody } from '@/lib/schemas/qc-checks';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

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
              qc.value_kind,
              qc.value_unit,
              qc.value_enum,
              qc.pass_min,
              qc.pass_max,
              tv.passed,
              tv.value_num,
              tv.value_text,
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
        WHERE (qc.sku_catalog_id = $4
           OR ($5::text IS NOT NULL AND qc.category = $5 AND qc.sku_catalog_id IS NULL))
          AND qc.status = 'published'
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
 * Body: { stepId, passed?, valueNum?, valueText?, notes? }
 *
 * When the step has a numeric pass band (pass_min/pass_max), the recorded
 * `valueNum` decides pass/fail server-side; otherwise the explicit `passed`
 * boolean is used (defaulting to true to preserve the legacy tap-to-pass UX).
 */
export const POST = withAuth(async (request, ctx) => {
  const serialUnitId = unitIdFromPath(request.nextUrl.pathname);
  if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid serial_unit id' }, { status: 400 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = parseBody(QcResultBody, raw);
  if (parsed instanceof NextResponse) return parsed;

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

    // Load the step's pass band + linked failure mode so the server (not the
    // client) decides pass/fail for value-kind steps and knows what to auto-tag.
    const stepRow = await pool.query<{
      pass_min: string | null;
      pass_max: string | null;
      failure_mode_id: number | null;
    }>(
      `SELECT pass_min, pass_max, failure_mode_id FROM qc_check_templates WHERE id = $1`,
      [parsed.stepId],
    );
    if (stepRow.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'step not found' }, { status: 404 });
    }
    const failureModeId = stepRow.rows[0].failure_mode_id;

    const passed = deriveStepPassed(stepRow.rows[0], {
      passed: parsed.passed ?? (parsed.valueNum == null && parsed.valueText == null ? true : undefined),
      valueNum: parsed.valueNum ?? null,
    });

    const verification = await upsertVerification({
      sourceKind: SOURCE_KIND,
      sourceRowId: serialUnitId,
      skuCatalogId,
      stepType: STEP_TYPE,
      stepId: parsed.stepId,
      passed,
      verifiedBy,
      notes: parsed.notes ?? null,
      valueNum: parsed.valueNum ?? null,
      valueText: parsed.valueText ?? null,
      failedModeId: passed === false ? failureModeId : null,
    });

    // Auto-tag-on-fail: a failed step that names a failure mode opens a tag on
    // the unit (idempotent per open mode). Best-effort — never fails the record.
    let autoTag: Awaited<ReturnType<typeof tagUnitFailure>> | null = null;
    if (passed === false && failureModeId != null) {
      try {
        autoTag = await tagUnitFailure({
          serialUnitId,
          failureModeId,
          detectedByStaffId: verifiedBy,
          source: 'qc',
          notes: `auto-tagged from failed QC step #${parsed.stepId}`,
        });
      } catch (tagErr) {
        console.warn('[checklist] auto-tag-on-fail failed (non-fatal)', tagErr);
      }
    }

    await recordAudit(pool, ctx, request, {
      source: 'serial-unit-checklist',
      action: AUDIT_ACTION.QC_RESULT_RECORD,
      entityType: AUDIT_ENTITY.SERIAL_UNIT,
      entityId: serialUnitId,
      method: 'manual',
      extra: {
        step_id: parsed.stepId,
        passed,
        value_num: parsed.valueNum ?? null,
        value_text: parsed.valueText ?? null,
        auto_failure_tag_id: autoTag?.id ?? null,
      },
    });

    return NextResponse.json({ ok: true, verification, failure_tag: autoTag });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to record step';
    console.error('[POST /api/serial-units/[id]/checklist] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'tech.qc_pass' });
