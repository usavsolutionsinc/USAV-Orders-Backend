import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { handoffToRepair } from '@/lib/warranty/linkage';
import { notifyWarrantyTransition } from '@/lib/warranty/notify';
import { claimIdFromPath, idempotentJson, warrantyFlagEnabled, warrantyFlagOff } from '@/lib/warranty/route-helpers';
import { WarrantyRepairHandoffBody } from '@/lib/schemas/warranty';

/**
 * POST /api/warranty/claims/[id]/repair-handoff
 *
 * Create a repair_service ticket from the claim and link it (APPROVED →
 * IN_REPAIR). Gated by WARRANTY_LOGGER. Permission: warranty.manage.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!warrantyFlagEnabled()) return warrantyFlagOff();
  const id = claimIdFromPath(request, 2);
  if (id == null) return NextResponse.json({ ok: false, error: 'invalid claim id' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const parsed = WarrantyRepairHandoffBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  return idempotentJson({
    request,
    staffId: ctx.staffId ?? null,
    route: 'POST /api/warranty/claims/[id]/repair-handoff',
    bodyKey: parsed.data.idempotencyKey ?? null,
    produce: async () => {
      const result = await handoffToRepair(id, {
        issue: parsed.data.issue ?? null,
        notes: parsed.data.notes ?? null,
        createdByStaffId: ctx.staffId ?? null,
      });
      if (!result.ok) return { status: result.status, body: { ok: false, error: result.error } };
      await recordAudit(pool, ctx, request, {
        source: 'warranty-logger',
        action: 'warranty.repair_handoff',
        entityType: 'warranty_claim',
        entityId: id,
        after: { repairServiceId: result.repairServiceId, status: result.claim.status },
      });
      if (result.claim.status === 'IN_REPAIR') {
        await notifyWarrantyTransition({ claim: result.claim, event: 'in_repair', actorStaffId: ctx.staffId ?? null });
      }
      return { status: 201, body: { ok: true, claim: result.claim, repairServiceId: result.repairServiceId } };
    },
  });
}, { permission: 'warranty.manage' });
