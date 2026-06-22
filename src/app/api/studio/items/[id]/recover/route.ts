import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import pool from '@/lib/db';
import { errorResponse } from '@/lib/api/errors';
import { recoverItem } from '@/lib/workflow/recover';
import { recordAudit, AUDIT_ENTITY } from '@/lib/audit-logs';

/**
 * POST /api/studio/items/[id]/recover
 *
 * Unpark one stuck workflow item: reset a blocked|error item_workflow_state row
 * back to active so the engine can advance it on the next tap. [id] is the
 * serial_unit_id. The domain logic (guarded reset + inventory_event +
 * workflow_runs + realtime nudge) lives in src/lib/workflow/recover — this is
 * the HTTP shell: id validation, the formal audit_logs row, and the response.
 *
 * Non-destructive + reversible, so no step-up (a re-park is one scan away).
 */
export const dynamic = 'force-dynamic';

export const POST = withAuth(
  async (request, ctx) => {
    const segments = request.nextUrl.pathname.split('/').filter(Boolean);
    // .../api/studio/items/[id]/recover → id is segments[-2]
    const serialUnitId = Number(segments[segments.length - 2]);
    if (!Number.isFinite(serialUnitId) || serialUnitId <= 0) {
      return NextResponse.json({ ok: false, error: 'invalid serial_unit id' }, { status: 400 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      /* empty body is fine */
    }
    const notesRaw = typeof body.notes === 'string' ? body.notes.trim() : '';
    const notes = notesRaw ? notesRaw.slice(0, 2000) : null;
    const actorStaffId: number | null =
      typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;

    try {
      const result = await recoverItem({
        orgId: ctx.organizationId,
        serialUnitId,
        actorStaffId,
        notes,
      });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
      }

      // Formal audit row — recordAudit never throws (logged + dropped on failure).
      await recordAudit(pool, ctx, request, {
        source: 'studio.recover',
        action: 'workflow.item.recover',
        entityType: AUDIT_ENTITY.SERIAL_UNIT,
        entityId: serialUnitId,
        method: 'manual',
        before: { workflowStatus: result.from },
        after: { workflowStatus: 'active' },
        note: notes,
        extra: {
          node_id: result.nodeId,
          workflow_definition_id: result.workflowDefinitionId,
        },
      });

      return NextResponse.json({
        ok: true,
        serial_unit_id: result.serialUnitId,
        from: result.from,
        node_id: result.nodeId,
      });
    } catch (err) {
      console.error('[POST /api/studio/items/[id]/recover] error:', err);
      return errorResponse(err, 'studio.recover');
    }
  },
  { permission: 'studio.recover', feature: 'studio' },
);
