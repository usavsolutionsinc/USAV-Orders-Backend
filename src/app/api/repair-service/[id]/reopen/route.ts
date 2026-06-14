import { NextRequest, NextResponse } from 'next/server';
import { getRepairById, unopenRepair } from '@/lib/neon/repair-service-queries';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishRepairChanged } from '@/lib/realtime/publish';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

/**
 * POST /api/repair-service/[id]/reopen — reverse of the DELETE soft-cancel.
 *
 * Restores a Cancelled repair to the EXACT status it held before cancellation
 * (recovered from status_history). Refuses (409) when the repair isn't
 * Cancelled or when no prior status can be recovered. Optional `?reason=`.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const gate = await requireRoutePerm(req, 'repair.intake');
    if (gate.denied) return gate.denied;
    const { id } = await params;
    const repairId = parseInt(id);
    if (isNaN(repairId)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    const reason = req.nextUrl.searchParams.get('reason')?.trim() || null;
    const before = await getRepairById(repairId);

    const result = await unopenRepair(repairId, reason);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    await invalidateCacheTags(['repair-service']);
    await publishRepairChanged({
      organizationId: gate.ctx.organizationId,
      repairIds: [repairId],
      source: 'repair-service.reopen',
    });
    await recordAudit(pool, gate.ctx, req, {
      source: 'repair-service-api',
      action: AUDIT_ACTION.REPAIR_REOPEN,
      entityType: AUDIT_ENTITY.REPAIR_SERVICE,
      entityId: repairId,
      before: before ? { ...before } : null,
      after: { ...result.repair },
      ...(reason ? { note: reason } : {}),
    });

    return NextResponse.json({ success: true, repair: result.repair });
  } catch (error: any) {
    console.error(`Error in POST /api/repair-service/${(await params).id}/reopen:`, error);
    return NextResponse.json(
      { error: 'Failed to reopen repair', details: error.message },
      { status: 500 },
    );
  }
}
