import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { parseBody } from '@/lib/schemas/parse';
import { FailureModeUpdateBody } from '@/lib/schemas/failure-modes';
import { updateFailureMode, deactivateFailureMode, listFailureModes } from '@/lib/neon/failure-modes-queries';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import pool from '@/lib/db';

/** withAuth doesn't forward Next params — resolve [id] from the path.
 *  .../api/failure-modes/[id] → id is the last segment. */
function idFromPath(pathname: string): number {
  const segments = pathname.split('/').filter(Boolean);
  return Number(segments[segments.length - 1]);
}

async function findMode(id: number) {
  const all = await listFailureModes();
  return all.find((m) => m.id === id) ?? null;
}

/** PATCH /api/failure-modes/[id] — update a taxonomy entry. */
export const PATCH = withAuth(async (req: NextRequest, ctx) => {
  try {
    const id = idFromPath(req.nextUrl.pathname);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }
    const raw = await req.json().catch(() => ({}));
    const parsed = parseBody(FailureModeUpdateBody, raw);
    if (parsed instanceof NextResponse) return parsed;

    const before = await findMode(id);
    if (!before) {
      return NextResponse.json({ success: false, error: 'Failure mode not found' }, { status: 404 });
    }

    const updated = await updateFailureMode(id, {
      label: parsed.label,
      category: parsed.category,
      severity: parsed.severity,
      isRepairable: parsed.isRepairable,
      typicalCostCents: parsed.typicalCostCents,
      capsGradeAt: parsed.capsGradeAt,
      sortOrder: parsed.sortOrder,
      active: parsed.active,
    });
    if (!updated) {
      return NextResponse.json({ success: false, error: 'No changes' }, { status: 400 });
    }

    await recordAudit(pool, ctx, req, {
      source: 'failure-modes-api',
      action: AUDIT_ACTION.FAILURE_MODE_UPDATE,
      entityType: AUDIT_ENTITY.FAILURE_MODE,
      entityId: id,
      before: { ...before },
      after: { ...updated },
    });
    return NextResponse.json({ success: true, mode: updated });
  } catch (error: any) {
    console.error('Error in PATCH /api/failure-modes/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update failure mode' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.manage' });

/** DELETE /api/failure-modes/[id] — soft delete (deactivate). */
export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  try {
    const id = idFromPath(req.nextUrl.pathname);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }
    const before = await findMode(id);
    const deactivated = await deactivateFailureMode(id);
    if (deactivated && before) {
      await recordAudit(pool, ctx, req, {
        source: 'failure-modes-api',
        action: AUDIT_ACTION.FAILURE_MODE_DELETE,
        entityType: AUDIT_ENTITY.FAILURE_MODE,
        entityId: id,
        before: { ...before },
        after: { ...before, active: false },
      });
    }
    return NextResponse.json({ success: true, deactivated });
  } catch (error: any) {
    console.error('Error in DELETE /api/failure-modes/[id]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete failure mode' },
      { status: 500 },
    );
  }
}, { permission: 'sku_stock.manage' });
