import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { revertClaimStatus } from '@/lib/warranty/mutations';
import { getClaimTicketRef } from '@/lib/warranty/claims';
import { claimIdFromPath, idempotentJson, warrantyFlagEnabled, warrantyFlagOff } from '@/lib/warranty/route-helpers';
import { WarrantyVerbBody } from '@/lib/schemas/warranty';

/**
 * POST /api/warranty/claims/[id]/revert — the single "undo" for the forward
 * lifecycle verbs (submit/approve/deny/close). Steps the claim back one stage
 * based on its current status (SUBMITTED→LOGGED, APPROVED→SUBMITTED,
 * DENIED→SUBMITTED clearing denial fields, CLOSED→pre-close status). IN_REPAIR
 * is reversed by detaching the repair, not here. No customer notification — a
 * revert is an internal correction. Gated by WARRANTY_LOGGER. warranty.manage.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!warrantyFlagEnabled()) return warrantyFlagOff();
  const id = claimIdFromPath(request, 2);
  if (id == null) return NextResponse.json({ ok: false, error: 'invalid claim id' }, { status: 400 });

  const owns = await getClaimTicketRef(id, ctx.organizationId);
  if (!owns) return NextResponse.json({ ok: false, error: 'claim not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const parsed = WarrantyVerbBody.safeParse(body);
  const bodyKey = parsed.success ? parsed.data.idempotencyKey ?? null : null;

  return idempotentJson({
    request,
    staffId: ctx.staffId ?? null,
    orgId: ctx.organizationId,
    route: 'POST /api/warranty/claims/[id]/revert',
    bodyKey,
    produce: async () => {
      const result = await revertClaimStatus(id, ctx.staffId ?? null);
      if (!result.ok) return { status: result.status, body: { ok: false, error: result.error } };
      await recordAudit(pool, ctx, request, {
        source: 'warranty-logger',
        action: 'warranty.revert',
        entityType: 'warranty_claim',
        entityId: id,
        after: { status: result.claim.status },
      });
      return { status: 200, body: { ok: true, claim: result.claim } };
    },
  });
}, { permission: 'warranty.manage' });
