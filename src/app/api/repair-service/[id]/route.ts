import { NextRequest, NextResponse } from 'next/server';
import { getRepairById, cancelRepair } from '@/lib/neon/repair-service-queries';
import { requireRoutePerm } from '@/lib/auth/dynamic-route-guard';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishRepairChanged } from '@/lib/realtime/publish';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

/**
 * GET /api/rs/[id] - Fetch single repair by ID
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireRoutePerm(req, 'repair.view');
    if (gate.denied) return gate.denied;
    const { id } = await params;
    const repairId = parseInt(id);

    if (isNaN(repairId)) {
      return NextResponse.json(
        { error: 'Invalid ID' },
        { status: 400 }
      );
    }

    const repair = await getRepairById(repairId);

    if (!repair) {
      return NextResponse.json(
        { error: 'Repair not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(repair);
  } catch (error: any) {
    console.error(`Error in GET /api/rs/${(await params).id}:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch repair', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/repair-service/[id] — soft-cancel a repair (status → 'Cancelled').
 *
 * No hard delete: repairs link to documents/customers/history. The row is
 * hidden from all list tabs but preserved for audit. Optional `?reason=`.
 */
export async function DELETE(
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

    const result = await cancelRepair(repairId, reason);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    if (!result.alreadyCancelled) {
      await invalidateCacheTags(['repair-service']);
      await publishRepairChanged({ repairIds: [repairId], source: 'repair-service.cancel' });
      await recordAudit(pool, gate.ctx, req, {
        source: 'repair-service-api',
        action: AUDIT_ACTION.REPAIR_CANCEL,
        entityType: AUDIT_ENTITY.REPAIR_SERVICE,
        entityId: repairId,
        before: before ? { ...before } : null,
        after: { ...result.repair },
        ...(reason ? { note: reason } : {}),
      });
    }

    return NextResponse.json({ success: true, repair: result.repair });
  } catch (error: any) {
    console.error(`Error in DELETE /api/repair-service/${(await params).id}:`, error);
    return NextResponse.json(
      { error: 'Failed to cancel repair', details: error.message },
      { status: 500 }
    );
  }
}
