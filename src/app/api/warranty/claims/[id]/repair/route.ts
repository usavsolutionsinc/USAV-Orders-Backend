import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { logRepairAttempt } from '@/lib/warranty/mutations';
import { getClaimTicketRef } from '@/lib/warranty/claims';
import { notifyWarrantyTransition } from '@/lib/warranty/notify';
import { claimIdFromPath, idempotentJson, warrantyFlagEnabled, warrantyFlagOff } from '@/lib/warranty/route-helpers';
import { WarrantyRepairBody } from '@/lib/schemas/warranty';

/**
 * POST /api/warranty/claims/[id]/repair
 *
 * Logs a repair attempt (diagnosis, parts-used, photos, outcome). Auto-advances
 * the claim APPROVED → IN_REPAIR, and IN_REPAIR → REPAIRED when outcome=FIXED.
 * Gated by WARRANTY_LOGGER. Permission: warranty.repair.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!warrantyFlagEnabled()) return warrantyFlagOff();
  const id = claimIdFromPath(request, 2);
  if (id == null) return NextResponse.json({ ok: false, error: 'invalid claim id' }, { status: 400 });

  const owns = await getClaimTicketRef(id, ctx.organizationId);
  if (!owns) return NextResponse.json({ ok: false, error: 'claim not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const parsed = WarrantyRepairBody.safeParse(body);
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
    route: 'POST /api/warranty/claims/[id]/repair',
    bodyKey: parsed.data.idempotencyKey ?? null,
    produce: async () => {
      const result = await logRepairAttempt(
        id,
        {
          technicianStaffId: parsed.data.technicianStaffId ?? ctx.staffId ?? null,
          diagnosis: parsed.data.diagnosis ?? null,
          partsUsed: parsed.data.partsUsed,
          outcome: parsed.data.outcome ?? null,
          laborMinutes: parsed.data.laborMinutes ?? null,
          costParts: parsed.data.costParts ?? null,
          costLabor: parsed.data.costLabor ?? null,
          photoAttachmentIds: parsed.data.photoAttachmentIds,
          notes: parsed.data.notes ?? null,
          startedAt: parsed.data.startedAt ?? null,
          completedAt: parsed.data.completedAt ?? null,
        },
        ctx.staffId ?? null,
        ctx.organizationId,
      );
      if (!result.ok) return { status: result.status, body: { ok: false, error: result.error } };
      await recordAudit(pool, ctx, request, {
        source: 'warranty-logger',
        action: 'warranty.repair',
        entityType: 'warranty_claim',
        entityId: id,
        after: { attemptId: result.attemptId, outcome: parsed.data.outcome ?? null, status: result.claim.status },
      });
      await notifyWarrantyTransition({
        organizationId: ctx.organizationId,
        claim: result.claim,
        event: result.claim.status === 'REPAIRED' ? 'repaired' : 'repair_logged',
        actorStaffId: ctx.staffId ?? null,
      });
      return { status: 201, body: { ok: true, attemptId: result.attemptId, claim: result.claim } };
    },
  });
}, { permission: 'warranty.repair', feature: 'repair' });
