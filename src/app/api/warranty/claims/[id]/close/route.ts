import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { closeClaim } from '@/lib/warranty/mutations';
import { notifyWarrantyTransition } from '@/lib/warranty/notify';
import { recordClaimZendeskEvent } from '@/lib/warranty/zendesk-link';
import { updateTicket } from '@/lib/zendesk';
import { claimIdFromPath, idempotentJson, warrantyFlagEnabled, warrantyFlagOff } from '@/lib/warranty/route-helpers';
import { WarrantyVerbBody } from '@/lib/schemas/warranty';

/**
 * POST /api/warranty/claims/[id]/close — APPROVED / DENIED / REPAIRED / EXPIRED → CLOSED.
 * Gated by WARRANTY_LOGGER.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!warrantyFlagEnabled()) return warrantyFlagOff();
  const id = claimIdFromPath(request, 2);
  if (id == null) return NextResponse.json({ ok: false, error: 'invalid claim id' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const parsed = WarrantyVerbBody.safeParse(body);
  const bodyKey = parsed.success ? parsed.data.idempotencyKey ?? null : null;

  return idempotentJson({
    request,
    staffId: ctx.staffId ?? null,
    route: 'POST /api/warranty/claims/[id]/close',
    bodyKey,
    produce: async () => {
      const result = await closeClaim(id, ctx.staffId ?? null);
      if (!result.ok) return { status: result.status, body: { ok: false, error: result.error } };
      await recordAudit(pool, ctx, request, {
        source: 'warranty-logger',
        action: 'warranty.close',
        entityType: 'warranty_claim',
        entityId: id,
        after: { status: 'CLOSED' },
      });
      await notifyWarrantyTransition({ claim: result.claim, event: 'closed', actorStaffId: ctx.staffId ?? null });

      // Round-trip: solve the linked Zendesk ticket. Best-effort — the claim is
      // already closed; a Zendesk hiccup surfaces as a warning, never an error.
      let zendeskWarning: string | null = null;
      if (result.claim.zendeskTicketId) {
        try {
          await updateTicket(result.claim.zendeskTicketId, {
            status: 'solved',
            comment: { body: `Warranty claim ${result.claim.claimNumber} closed in USAV Orders.`, public: false },
          });
          await recordClaimZendeskEvent({
            claimId: id,
            eventType: 'ZENDESK_STATUS',
            payload: { zendeskTicketId: result.claim.zendeskTicketId, status: 'solved' },
            actorStaffId: ctx.staffId ?? null,
          });
        } catch (zdErr) {
          zendeskWarning = `Claim closed, but Zendesk ticket #${result.claim.zendeskTicketId} was not solved: ${
            zdErr instanceof Error ? zdErr.message : 'request failed'
          }`;
          console.warn('[warranty.close] zendesk solve failed', zdErr);
        }
      }

      return {
        status: 200,
        body: { ok: true, claim: result.claim, ...(zendeskWarning ? { zendeskWarning } : {}) },
      };
    },
  });
}, { permission: 'warranty.manage' });
