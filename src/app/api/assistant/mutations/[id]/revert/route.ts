import { NextRequest, NextResponse } from 'next/server';
import { requireRoutePerm, recordRouteAudit } from '@/lib/auth/dynamic-route-guard';
import { revertAgentMutation } from '@/lib/assistant/mutations/apply-agent-mutation';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/assistant/mutations/[id]/revert — undo an applied, revertable
 * mutation (universal-feed plan §2.6). studio.manage (same gate as draft
 * editing); org/staff from ctx. Maps 404/409/200; audit + ops_event + Ably
 * fire inside revertAgentMutation's side-effects.
 */
export async function POST(req: NextRequest) {
  const gate = await requireRoutePerm(req, 'studio.manage');
  if (gate.denied) return gate.denied;
  const ctx = gate.ctx;

  const segments = req.nextUrl.pathname.split('/').filter(Boolean);
  // .../assistant/mutations/[id]/revert → id is segments[-2]
  const id = Number(segments[segments.length - 2]);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ success: false, error: 'invalid mutation id' }, { status: 400 });
  }

  const result = await revertAgentMutation(id, ctx.organizationId, ctx.staffId ?? null);
  const response = NextResponse.json(
    result.ok ? { success: true, mutationId: id } : { success: false, error: result.error },
    { status: result.ok ? 200 : result.status },
  );
  if (result.ok) {
    await recordRouteAudit(req, ctx, response, {
      source: 'assistant.mutation',
      action: AUDIT_ACTION.AGENT_MUTATION_REVERT,
      entityType: AUDIT_ENTITY.AGENT_MUTATION,
      entityId: () => id,
    });
  }
  return response;
}
