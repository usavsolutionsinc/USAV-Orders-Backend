import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { issueRmaForClaim, linkRmaByNumber } from '@/lib/warranty/linkage';
import { claimIdFromPath, idempotentJson, warrantyFlagEnabled, warrantyFlagOff } from '@/lib/warranty/route-helpers';
import { WarrantyRmaBody } from '@/lib/schemas/warranty';

/**
 * POST /api/warranty/claims/[id]/rma
 *
 * Issue a new INBOUND_FROM_CUSTOMER RMA for the claim (default), or link an
 * existing RMA when `rmaNumber` is supplied. Sets warranty_claims.rma_id.
 * Gated by WARRANTY_LOGGER. Permission: warranty.manage.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!warrantyFlagEnabled()) return warrantyFlagOff();
  if (typeof ctx.staffId !== 'number' || ctx.staffId <= 0) {
    return NextResponse.json({ ok: false, error: 'authenticated staff required' }, { status: 401 });
  }
  const id = claimIdFromPath(request, 2);
  if (id == null) return NextResponse.json({ ok: false, error: 'invalid claim id' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const parsed = WarrantyRmaBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  return idempotentJson({
    request,
    staffId: ctx.staffId,
    route: 'POST /api/warranty/claims/[id]/rma',
    bodyKey: parsed.data.idempotencyKey ?? null,
    produce: async () => {
      const result = parsed.data.rmaNumber
        ? await linkRmaByNumber(id, parsed.data.rmaNumber, ctx.staffId)
        : await issueRmaForClaim(id, {
            createdByStaffId: ctx.staffId,
            expectedCarrier: parsed.data.expectedCarrier ?? null,
            expiresAt: parsed.data.expiresAt ?? null,
            notes: parsed.data.notes ?? null,
          });
      if (!result.ok) return { status: result.status, body: { ok: false, error: result.error } };
      await recordAudit(pool, ctx, request, {
        source: 'warranty-logger',
        action: 'warranty.rma_link',
        entityType: 'warranty_claim',
        entityId: id,
        after: { rmaId: result.rma.id, rmaNumber: result.rma.rmaNumber, issued: !parsed.data.rmaNumber },
      });
      return { status: 200, body: { ok: true, claim: result.claim, rma: result.rma } };
    },
  });
}, { permission: 'warranty.manage' });
