import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { RepairCreateBody } from '@/lib/schemas/repairs';
import { listUnitRepairs, openRepair } from '@/lib/neon/repairs-queries';
import { recomputeUnitQualitySafe } from '@/lib/neon/quality-queries';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

/** .../api/serial-units/[id]/repairs → id is segments[-2]. */
function unitIdFromPath(pathname: string): number {
  const segments = pathname.split('/').filter(Boolean);
  return Number(segments[segments.length - 2]);
}

/** GET — repair history for a unit (newest first), with staff + resolved modes. */
export const GET = withAuth(async (request, ctx) => {
  const serialUnitId = unitIdFromPath(request.nextUrl.pathname);
  if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid serial_unit id' }, { status: 400 });
  }
  try {
    // Org-scoped read: listUnitRepairs filters unit_repairs by organization_id,
    // so a cross-tenant serial_unit id yields an empty list (no disclosure).
    const repairs = await listUnitRepairs(serialUnitId, ctx.organizationId);
    return NextResponse.json({ ok: true, repairs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to load repairs';
    console.error('[GET /api/serial-units/[id]/repairs] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'repair.view' });

/** POST — open a repair (moves the unit to IN_REPAIR, emits REPAIR_STARTED). */
export const POST = withAuth(async (request, ctx) => {
  const serialUnitId = unitIdFromPath(request.nextUrl.pathname);
  if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid serial_unit id' }, { status: 400 });
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = parseBody(RepairCreateBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  try {
    // Org-ownership gate (404, never 403): openRepair resolves serial_units with
    // an explicit organization_id predicate when orgId is threaded, so a
    // cross-tenant unit throws "unit not found" → mapped to 404 below.
    const repair = await openRepair({
      serialUnitId,
      summary: parsed.summary,
      status: parsed.status,
      failureModeIds: parsed.failureModeIds,
      rmaId: parsed.rmaId ?? null,
      repairServiceId: parsed.repairServiceId ?? null,
      staffId: ctx.staffId,
      clientEventId: parsed.clientEventId ?? null,
    }, ctx.organizationId);

    await recordAudit(pool, ctx, request, {
      source: 'serial-unit-repairs',
      action: AUDIT_ACTION.REPAIR_OPEN,
      entityType: AUDIT_ENTITY.UNIT_REPAIR,
      entityId: repair.id,
      after: { ...repair },
      extra: { serial_unit_id: serialUnitId, failure_mode_ids: parsed.failureModeIds ?? [] },
    });

    await recomputeUnitQualitySafe(serialUnitId, ctx.organizationId);
    return NextResponse.json({ ok: true, repair }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to open repair';
    const status = message === 'unit not found' ? 404 : 500;
    console.error('[POST /api/serial-units/[id]/repairs] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}, { permission: 'repair.mark_repaired' });
