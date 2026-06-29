import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/audit-logs';
import { isFulfillmentSubstitution } from '@/lib/feature-flags';
import { decideAmendment } from '@/lib/fulfillment/substitution';
import type { OrgId } from '@/lib/tenancy/constants';

/**
 * POST /api/order-amendments/[id]/decision
 *
 * Approve or reject a PENDING substitution amendment (the block_until_approved
 * enforcement path). APPROVE clears the /api/pack/ship hold — the re-allocation
 * already stands. REJECT reverts it: the substitute unit is released back to
 * stock and the original unit is best-effort re-allocated to the order.
 *
 * Body: { decision: 'approve' | 'reject', client_event_id?: string }
 *
 * Permission: packing.approve_amendment.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!isFulfillmentSubstitution()) {
    return NextResponse.json({ ok: false, error: 'substitution is not enabled' }, { status: 403 });
  }

  const orgId = ctx.organizationId as OrgId;

  // [id] segment: /api/order-amendments/{id}/decision → second-to-last.
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const amendmentId = Number(segments[segments.length - 2]);
  if (!Number.isFinite(amendmentId) || amendmentId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid amendment id' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const decisionRaw = String(body?.decision || '').trim().toLowerCase();
  if (decisionRaw !== 'approve' && decisionRaw !== 'reject') {
    return NextResponse.json({ ok: false, error: "decision must be 'approve' or 'reject'" }, { status: 400 });
  }
  const decision = decisionRaw === 'approve' ? 'APPROVE' : 'REJECT';
  const clientEventId = String(body?.client_event_id || '').trim() || null;

  const actorStaffId: number | null = typeof ctx.staffId === 'number' && ctx.staffId > 0 ? ctx.staffId : null;

  const result = await decideAmendment({ amendmentId, decision, actorStaffId, clientEventId }, orgId);

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }

  await recordAudit(pool, ctx, request, {
    source: 'orders.substitute.decision',
    action: decision === 'APPROVE' ? AUDIT_ACTION.ORDER_AMENDMENT_APPROVE : AUDIT_ACTION.ORDER_AMENDMENT_REJECT,
    entityType: AUDIT_ENTITY.ORDER_AMENDMENT,
    entityId: amendmentId,
    method: 'manual',
    after: { status: result.status },
    extra: {
      order_id: result.orderId,
      ...(decision === 'REJECT' ? { original_reallocated: result.originalReallocated } : {}),
    },
  });

  return NextResponse.json(result);
}, { permission: 'packing.approve_amendment' });
