import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { submitClaim } from '@/lib/warranty/mutations';
import { getClaimTicketRef } from '@/lib/warranty/claims';
import { notifyWarrantyTransition } from '@/lib/warranty/notify';
import { claimIdFromPath, idempotentJson, warrantyFlagEnabled, warrantyFlagOff } from '@/lib/warranty/route-helpers';
import { WarrantyVerbBody } from '@/lib/schemas/warranty';

/**
 * POST /api/warranty/claims/[id]/submit — LOGGED → SUBMITTED. Gated by WARRANTY_LOGGER.
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
    route: 'POST /api/warranty/claims/[id]/submit',
    bodyKey,
    produce: async () => {
      const result = await submitClaim(id, ctx.staffId ?? null);
      if (!result.ok) return { status: result.status, body: { ok: false, error: result.error } };
      await recordAudit(pool, ctx, request, {
        source: 'warranty-logger',
        action: 'warranty.submit',
        entityType: 'warranty_claim',
        entityId: id,
        after: { status: 'SUBMITTED' },
      });
      await notifyWarrantyTransition({ organizationId: ctx.organizationId, claim: result.claim, event: 'submitted', actorStaffId: ctx.staffId ?? null });
      return { status: 200, body: { ok: true, claim: result.claim } };
    },
  });
}, { permission: 'warranty.manage' });
