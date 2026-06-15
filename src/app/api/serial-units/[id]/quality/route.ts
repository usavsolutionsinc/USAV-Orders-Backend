import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { tenantQuery } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { recomputeUnitQuality } from '@/lib/neon/quality-queries';
import { listUnitFailureTags } from '@/lib/neon/failure-modes-queries';
import { listUnitRepairs } from '@/lib/neon/repairs-queries';

/** .../api/serial-units/[id]/quality → id is segments[-2]. */
function unitIdFromPath(pathname: string): number {
  const segments = pathname.split('/').filter(Boolean);
  return Number(segments[segments.length - 2]);
}

/**
 * GET /api/serial-units/[id]/quality — the unit's quality snapshot for the
 * detail pane: a freshly recomputed score + risk, the current grade, all
 * failure tags, and repair history. The score recompute is self-healing, so
 * this read always reflects the latest grade/failures/repairs.
 */
export const GET = withAuth(async (request, ctx) => {
  const orgId = ctx.organizationId as OrgId;
  const serialUnitId = unitIdFromPath(request.nextUrl.pathname);
  if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid serial_unit id' }, { status: 400 });
  }

  try {
    // Org-ownership precheck: gate both the read and the downstream quality
    // recompute on a unit that belongs to this tenant — a foreign unit id
    // 404s (never 403) exactly like a missing one.
    const exists = await tenantQuery<{ condition_grade: string | null; current_status: string | null }>(
      orgId,
      `SELECT condition_grade::text AS condition_grade, current_status::text AS current_status
         FROM serial_units WHERE id = $1 AND organization_id = $2`,
      [serialUnitId, orgId],
    );
    if (exists.rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'unit not found' }, { status: 404 });
    }

    const [quality, failures, repairs] = await Promise.all([
      recomputeUnitQuality(serialUnitId),
      listUnitFailureTags(serialUnitId),
      listUnitRepairs(serialUnitId),
    ]);

    return NextResponse.json({
      ok: true,
      grade: exists.rows[0].condition_grade,
      current_status: exists.rows[0].current_status,
      quality,
      failure_tags: failures,
      repairs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to load quality';
    console.error('[GET /api/serial-units/[id]/quality] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'sku_stock.view' });
