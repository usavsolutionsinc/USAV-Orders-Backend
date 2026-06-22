import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { getClaimTicketRef } from '@/lib/warranty/claims';
import { recordClaimZendeskEvent } from '@/lib/warranty/zendesk-link';
import { claimIdFromPath, idempotentJson, warrantyFlagEnabled, warrantyFlagOff } from '@/lib/warranty/route-helpers';
import { WarrantyZendeskCommentBody } from '@/lib/schemas/warranty';
import {
  addTicketComment,
  listTicketComments,
  ZendeskApiError,
  ZendeskNotConfiguredError,
  type ZendeskComment,
} from '@/lib/zendesk';
import type { WarrantyZendeskComment } from '@/lib/warranty/zendesk-format';

export const dynamic = 'force-dynamic';

function toSlimComment(c: ZendeskComment): WarrantyZendeskComment {
  return {
    id: c.id,
    body: c.body,
    htmlBody: c.html_body ?? null,
    public: Boolean(c.public),
    authorId: c.author_id ?? null,
    createdAt: c.created_at,
  };
}

/**
 * GET /api/warranty/claims/[id]/zendesk/comments
 *
 * The linked ticket's comment thread (replies + internal notes), fetched live
 * from Zendesk — read-time sync, nothing cached locally. Returns an empty list
 * (not an error) when the claim has no linked ticket so the popover can render
 * the internal-events-only timeline. Gated by WARRANTY_LOGGER.
 */
export const GET = withAuth(async (request, ctx) => {
  if (!warrantyFlagEnabled()) return warrantyFlagOff();
  const id = claimIdFromPath(request, 3);
  if (id == null) return NextResponse.json({ ok: false, error: 'invalid claim id' }, { status: 400 });

  try {
    const claim = await getClaimTicketRef(id, ctx.organizationId);
    if (!claim) return NextResponse.json({ ok: false, error: 'claim not found' }, { status: 404 });
    if (!claim.zendeskTicketId) {
      return NextResponse.json({ ok: true, ticketId: null, comments: [], count: 0 });
    }

    const sp = request.nextUrl.searchParams;
    const page = Math.max(1, Number(sp.get('page')) || 1);
    const perPage = Math.min(100, Math.max(1, Number(sp.get('perPage')) || 100));
    const result = await listTicketComments(claim.zendeskTicketId, { page, perPage });
    return NextResponse.json({
      ok: true,
      ticketId: claim.zendeskTicketId,
      comments: result.comments.map(toSlimComment),
      count: result.count,
      hasMore: result.next_page != null,
    });
  } catch (err) {
    if (err instanceof ZendeskNotConfiguredError) {
      return NextResponse.json({ ok: false, error: 'Zendesk is not configured' }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : 'zendesk comments fetch failed';
    console.error('[GET /api/warranty/claims/[id]/zendesk/comments] error:', err);
    const status = err instanceof ZendeskApiError ? 502 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}, { permission: 'warranty.view' });

/**
 * POST /api/warranty/claims/[id]/zendesk/comments
 *
 * Adds a reply to the linked ticket (`public: true` = customer-visible,
 * default = internal note) and appends a ZENDESK_REPLY row to the claim
 * timeline. 409 when the claim has no linked ticket yet. Idempotent via
 * `Idempotency-Key` header or `idempotencyKey` body field. Gated by
 * WARRANTY_LOGGER.
 */
export const POST = withAuth(async (request, ctx) => {
  if (!warrantyFlagEnabled()) return warrantyFlagOff();
  const id = claimIdFromPath(request, 3);
  if (id == null) return NextResponse.json({ ok: false, error: 'invalid claim id' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const parsed = WarrantyZendeskCommentBody.safeParse(body);
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
    route: 'POST /api/warranty/claims/[id]/zendesk/comments',
    bodyKey: parsed.data.idempotencyKey ?? null,
    produce: async () => {
      const claim = await getClaimTicketRef(id, ctx.organizationId);
      if (!claim) return { status: 404, body: { ok: false, error: 'claim not found' } };
      if (!claim.zendeskTicketId) {
        return {
          status: 409,
          body: { ok: false, error: 'claim has no linked Zendesk ticket — create one first' },
        };
      }

      const isPublic = parsed.data.public === true;
      let ticket;
      try {
        ticket = await addTicketComment(claim.zendeskTicketId, {
          body: parsed.data.body,
          public: isPublic,
        });
      } catch (err) {
        if (err instanceof ZendeskNotConfiguredError) {
          return { status: 503, body: { ok: false, error: 'Zendesk is not configured' } };
        }
        return {
          status: 502,
          body: { ok: false, error: err instanceof Error ? err.message : 'Zendesk request failed' },
        };
      }
      if (!ticket) {
        return {
          status: 404,
          body: { ok: false, error: `Zendesk ticket #${claim.zendeskTicketId} no longer exists` },
        };
      }

      // Best-effort timeline echo — the reply already landed in Zendesk.
      try {
        await recordClaimZendeskEvent({
          claimId: claim.id,
          eventType: 'ZENDESK_REPLY',
          payload: {
            zendeskTicketId: claim.zendeskTicketId,
            public: isPublic,
            // Code-point slice so a multi-byte char never splits at the boundary.
            preview: Array.from(parsed.data.body).slice(0, 140).join(''),
          },
          actorStaffId: ctx.staffId ?? null,
        });
      } catch (eventErr) {
        console.warn('[warranty.zendesk] reply event insert failed', eventErr);
      }

      await recordAudit(pool, ctx, request, {
        source: 'warranty-logger',
        action: 'warranty.zendesk_reply',
        entityType: 'warranty_claim',
        entityId: claim.id,
        after: { zendeskTicketId: claim.zendeskTicketId, public: isPublic },
      });

      return {
        status: 201,
        body: { ok: true, ticketId: claim.zendeskTicketId, ticketStatus: ticket.status },
      };
    },
  });
}, { permission: 'warranty.manage' });
