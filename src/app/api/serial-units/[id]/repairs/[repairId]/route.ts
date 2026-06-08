import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { RepairUpdateBody } from '@/lib/schemas/repairs';
import { updateRepair } from '@/lib/neon/repairs-queries';
import { recomputeUnitQualitySafe } from '@/lib/neon/quality-queries';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

/** .../api/serial-units/[id]/repairs/[repairId] → repairId is the last segment. */
function repairIdFromPath(pathname: string): number {
  const segments = pathname.split('/').filter(Boolean);
  return Number(segments[segments.length - 1]);
}

/**
 * PATCH — update a repair. A terminal status (completed/failed/scrapped) sets
 * completion fields, moves the unit to REPAIR_DONE, emits REPAIR_COMPLETED, and
 * (on 'completed') resolves the unit's open failure tags this repair addresses.
 */
export const PATCH = withAuth(async (request, ctx) => {
  const repairId = repairIdFromPath(request.nextUrl.pathname);
  if (!Number.isFinite(repairId) || repairId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid repair id' }, { status: 400 });
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = parseBody(RepairUpdateBody, raw);
  if (parsed instanceof NextResponse) return parsed;

  try {
    const repair = await updateRepair(repairId, {
      status: parsed.status,
      summary: parsed.summary,
      partsUsed: parsed.partsUsed,
      laborMinutes: parsed.laborMinutes,
      costCents: parsed.costCents,
      staffId: ctx.staffId,
      clientEventId: parsed.clientEventId ?? null,
    });
    if (!repair) {
      return NextResponse.json({ ok: false, error: 'repair not found' }, { status: 404 });
    }

    const terminal = repair.status === 'completed' || repair.status === 'failed' || repair.status === 'scrapped';
    await recordAudit(pool, ctx, request, {
      source: 'serial-unit-repairs',
      action: terminal ? AUDIT_ACTION.REPAIR_COMPLETE : AUDIT_ACTION.REPAIR_UPDATE,
      entityType: AUDIT_ENTITY.UNIT_REPAIR,
      entityId: repairId,
      after: { ...repair },
      extra: { serial_unit_id: repair.serial_unit_id, status: repair.status },
    });

    await recomputeUnitQualitySafe(repair.serial_unit_id);
    return NextResponse.json({ ok: true, repair });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to update repair';
    console.error('[PATCH /api/serial-units/[id]/repairs/[repairId]] error:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'repair.mark_repaired' });
