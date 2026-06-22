import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { denyClaim } from '@/lib/warranty/mutations';
import { getClaimTicketRef } from '@/lib/warranty/claims';
import { notifyWarrantyTransition } from '@/lib/warranty/notify';
import { claimIdFromPath, idempotentJson, warrantyFlagEnabled, warrantyFlagOff } from '@/lib/warranty/route-helpers';
import { WarrantyDenyBody } from '@/lib/schemas/warranty';

/**
 * POST /api/warranty/claims/[id]/deny — SUBMITTED → DENIED (reason required).
 * Gated by WARRANTY_LOGGER.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!warrantyFlagEnabled()) return warrantyFlagOff();
  const id = claimIdFromPath(request, 2);
  if (id == null) return NextResponse.json({ ok: false, error: 'invalid claim id' }, { status: 400 });

  const owns = await getClaimTicketRef(id, ctx.organizationId);
  if (!owns) return NextResponse.json({ ok: false, error: 'claim not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const parsed = WarrantyDenyBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  return idempotentJson({
    request,
    staffId: ctx.staffId ?? null,
    orgId: ctx.organizationId,
    route: 'POST /api/warranty/claims/[id]/deny',
    bodyKey: parsed.data.idempotencyKey ?? null,
    produce: async () => {
      const result = await denyClaim(id, {
        reasonCode: parsed.data.reasonCode,
        denialNotes: parsed.data.denialNotes ?? null,
        actorStaffId: ctx.staffId ?? null,
      });
      if (!result.ok) return { status: result.status, body: { ok: false, error: result.error } };
      await recordAudit(pool, ctx, request, {
        source: 'warranty-logger',
        action: 'warranty.deny',
        entityType: 'warranty_claim',
        entityId: id,
        reasonCode: parsed.data.reasonCode,
        after: { status: 'DENIED', reasonCode: parsed.data.reasonCode },
      });
      await notifyWarrantyTransition({ organizationId: ctx.organizationId, claim: result.claim, event: 'denied', actorStaffId: ctx.staffId ?? null });
      return { status: 200, body: { ok: true, claim: result.claim } };
    },
  });
}, { permission: 'warranty.manage' });
