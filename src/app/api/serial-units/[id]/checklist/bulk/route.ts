import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { parseBody } from '@/lib/schemas/parse';
import { QcBulkBody } from '@/lib/schemas/qc-checks';

/**
 * Bulk "check all" / "clear all" for a unit's testing checklist.
 *
 * The per-step endpoint (../checklist) records one step at a time. When the
 * checklist is long — or a tech has eyeballed a known-good unit — settling it
 * one tap at a time is tedious. This endpoint records (or clears) EVERY
 * resolved step for the unit's SKU in a single transaction.
 *
 * Steps resolve exactly like the GET in ../checklist: per-SKU template rows
 * (qc_check_templates.sku_catalog_id = unit's catalog) plus category-shared
 * rows (sku_catalog_id IS NULL AND category = unit's category).
 *
 * Body: { action?: 'pass' | 'clear' }  (default 'pass')
 *   - 'pass'  → upsert passed=true for every step, attributed to the caller.
 *   - 'clear' → delete this unit's recorded results, returning steps to
 *               "not recorded" (so progress goes back to 0/N).
 *
 * Advisory only — recording results never gates grading. QC completion is a
 * signal, not a lock.
 */

const SOURCE_KIND = 'serial_unit';
const STEP_TYPE = 'QC';

function unitIdFromPath(pathname: string): number {
  const segments = pathname.split('/').filter(Boolean);
  // .../api/serial-units/[id]/checklist/bulk → id is segments[-3]
  return Number(segments[segments.length - 3]);
}

export const POST = withAuth(async (request, ctx) => {
  const serialUnitId = unitIdFromPath(request.nextUrl.pathname);
  if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid serial_unit id' }, { status: 400 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = parseBody(QcBulkBody, raw);
  if (parsed instanceof NextResponse) return parsed;
  const action = parsed.action;

  const verifiedBy = Number(ctx.staffId);
  if (!Number.isFinite(verifiedBy) || verifiedBy <= 0) {
    return NextResponse.json({ ok: false, error: 'no staff identity on request' }, { status: 401 });
  }

  const orgId = ctx.organizationId;

  try {
    const unit = await tenantQuery<{ sku_catalog_id: number | null; category: string | null }>(
      orgId,
      `SELECT su.sku_catalog_id, sc.category
         FROM serial_units su
    LEFT JOIN sku_catalog sc ON sc.id = su.sku_catalog_id
                            AND sc.organization_id = su.organization_id
        WHERE su.id = $1
          AND su.organization_id = $2`,
      [serialUnitId, orgId],
    );
    if (unit.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'unit not found' }, { status: 404 });
    }
    const skuCatalogId = unit.rows[0].sku_catalog_id;
    const category = unit.rows[0].category;
    if (skuCatalogId == null) {
      return NextResponse.json(
        { ok: false, error: 'unit has no SKU catalog row — cannot record checklist' },
        { status: 409 },
      );
    }

    // The set of steps in scope for this unit (per-SKU + category-shared).
    // Only published steps are settled — drafts under authoring are excluded.
    const STEP_SCOPE = `(qc.sku_catalog_id = $2
        OR ($3::text IS NOT NULL AND qc.category = $3 AND qc.sku_catalog_id IS NULL))
        AND qc.status = 'published'`;

    // "Pass all" only blanket-passes pass/fail steps. Value-input kinds
    // (percent/number/enum/text) need a real recorded value, so bulk skips them.
    const PASSABLE = `(qc.value_kind IS NULL OR qc.value_kind = 'BOOLEAN')`;

    const affected = await withTenantTransaction(orgId, async (client) => {
      let count = 0;
      if (action === 'clear') {
        const del = await client.query(
          `DELETE FROM tech_verifications tv
             USING qc_check_templates qc
            WHERE tv.source_kind   = '${SOURCE_KIND}'
              AND tv.step_type     = '${STEP_TYPE}'
              AND tv.source_row_id = $1
              AND tv.step_id       = qc.id
              AND tv.organization_id = qc.organization_id
              AND qc.organization_id = $4
              AND ${STEP_SCOPE}`,
          [serialUnitId, skuCatalogId, category, orgId],
        );
        count = del.rowCount ?? 0;
      } else {
        // pass — update existing rows, then insert the missing ones. Two
        // set-based statements avoid depending on a specific unique-index name
        // for ON CONFLICT (mirrors the upsert seam in upsertVerification).
        const upd = await client.query(
          `UPDATE tech_verifications tv
              SET passed = true, verified_by = $4, verified_at = NOW()
             FROM qc_check_templates qc
            WHERE tv.source_kind   = '${SOURCE_KIND}'
              AND tv.step_type     = '${STEP_TYPE}'
              AND tv.source_row_id = $1
              AND tv.step_id       = qc.id
              AND tv.organization_id = qc.organization_id
              AND qc.organization_id = $5
              AND ${STEP_SCOPE}
              AND ${PASSABLE}`,
          [serialUnitId, skuCatalogId, category, verifiedBy, orgId],
        );
        const ins = await client.query(
          `INSERT INTO tech_verifications
             (source_kind, source_row_id, sku_catalog_id, step_type, step_id, passed, verified_by, organization_id)
           SELECT '${SOURCE_KIND}', $1, $2, '${STEP_TYPE}', qc.id, true, $4, $5
             FROM qc_check_templates qc
            WHERE qc.organization_id = $5
              AND ${STEP_SCOPE}
              AND ${PASSABLE}
              AND NOT EXISTS (
                SELECT 1 FROM tech_verifications tv
                 WHERE tv.source_kind   = '${SOURCE_KIND}'
                   AND tv.step_type     = '${STEP_TYPE}'
                   AND tv.source_row_id = $1
                   AND tv.step_id       = qc.id
                   AND tv.organization_id = qc.organization_id
              )`,
          [serialUnitId, skuCatalogId, category, verifiedBy, orgId],
        );
        count = (upd.rowCount ?? 0) + (ins.rowCount ?? 0);
      }
      return count;
    });

    // Refreshed progress tally, same shape as the per-step route's GET.
    const tally = await tenantQuery<{ completed: string; total: string }>(
      orgId,
      `SELECT COUNT(tv.passed)::text AS completed, COUNT(qc.id)::text AS total
         FROM qc_check_templates qc
    LEFT JOIN tech_verifications tv
           ON tv.step_id       = qc.id
          AND tv.step_type     = '${STEP_TYPE}'
          AND tv.source_kind   = '${SOURCE_KIND}'
          AND tv.source_row_id = $1
          AND tv.organization_id = qc.organization_id
        WHERE qc.organization_id = $4
          AND ${STEP_SCOPE}`,
      [serialUnitId, skuCatalogId, category, orgId],
    );
    const completed = Number(tally.rows[0]?.completed ?? 0);
    const total = Number(tally.rows[0]?.total ?? 0);

    await recordAudit(pool, ctx, request, {
      source: 'serial-unit-checklist',
      action: action === 'pass' ? AUDIT_ACTION.TECH_QC_PASS : AUDIT_ACTION.TECH_QC_FAIL,
      entityType: AUDIT_ENTITY.SERIAL_UNIT,
      entityId: serialUnitId,
      method: 'manual',
      note: action === 'pass' ? 'bulk check-all' : 'bulk clear-all',
      extra: { bulk: true, action, steps_affected: affected, completed, total },
    });

    return NextResponse.json({
      ok: true,
      action,
      steps_affected: affected,
      progress: { completed, total },
    });
  } catch (err) {
    // withTenantTransaction already rolled back the mutation transaction on throw.
    const message = err instanceof Error ? err.message : 'bulk checklist update failed';
    console.error('[POST /api/serial-units/[id]/checklist/bulk] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'tech.qc_pass' });
