import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { recordAudit } from '@/lib/audit-logs';
import pool from '@/lib/db';
import { getClaimTicketRef } from '@/lib/warranty/claims';
import { recordClaimTicketLink, unlinkClaimTicket } from '@/lib/warranty/zendesk-link';
import {
  claimIdFromPath,
  idempotentJson,
  warrantyFlagEnabled,
  warrantyFlagOff,
} from '@/lib/warranty/route-helpers';
import { WarrantyZendeskLinkBody } from '@/lib/schemas/warranty';
import {
  getTicket,
  updateTicket,
  ZendeskApiError,
  ZendeskNotConfiguredError,
} from '@/lib/zendesk';
import { buildExternalId, getTicketEntity } from '@/lib/zendesk-links';
import { listTicketLinkCandidates } from '@/lib/zendesk-link-candidates';
import { zendeskTicketUrl } from '@/lib/zendesk-ticket-url';

export const dynamic = 'force-dynamic';

/**
 * Link an EXISTING Zendesk ticket to a warranty claim — the counterpart to
 * POST /api/warranty/claims/[id]/zendesk (which mints a fresh ticket), and the
 * symmetric reverse of both.
 *
 *   GET    ?query=...  → link candidates (recent list / Zendesk search / direct
 *          "#1234" id lookup), hiding tickets already linked to another entity.
 *          The direct-id branch is the manual-entry path: typing a ticket # by
 *          hand resolves identically to picking one from the list.
 *   POST   { ticketId } → attach an existing ticket: warranty_claims
 *          .zendesk_ticket_id + ticket_links row + external_id backfill +
 *          ZENDESK_LINKED timeline event. 409 if the claim already has a ticket.
 *   DELETE ?ticketId=N → detach: null the column, drop the ticket_links row,
 *          clear the dangling external_id, append ZENDESK_UNLINKED. The Zendesk
 *          ticket itself is never deleted.
 *
 * Mirrors src/app/api/receiving/zendesk-claim/link/route.ts for the
 * WARRANTY_CLAIM entity. Gated by WARRANTY_LOGGER.
 */

const ZENDESK_NOT_CONFIGURED = NextResponse.json(
  { ok: false, error: 'Zendesk is not configured' },
  { status: 503 },
);

export const GET = withAuth(async (request, ctx) => {
  if (!warrantyFlagEnabled()) return warrantyFlagOff();
  const id = claimIdFromPath(request, 3);
  if (id == null) return NextResponse.json({ ok: false, error: 'invalid claim id' }, { status: 400 });

  try {
    const claim = await getClaimTicketRef(id, ctx.organizationId);
    if (!claim) return NextResponse.json({ ok: false, error: 'claim not found' }, { status: 404 });

    const { tickets, hiddenLinked } = await listTicketLinkCandidates({
      orgId: ctx.organizationId,
      entityType: 'WARRANTY_CLAIM',
      entityId: id,
      query: request.nextUrl.searchParams.get('query'),
    });

    return NextResponse.json({ ok: true, tickets, hiddenLinked });
  } catch (err) {
    if (err instanceof ZendeskNotConfiguredError) return ZENDESK_NOT_CONFIGURED;
    const message = err instanceof Error ? err.message : 'zendesk candidate lookup failed';
    console.error('[GET /api/warranty/claims/[id]/zendesk/link] error:', err);
    const status = err instanceof ZendeskApiError ? 502 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}, { permission: 'warranty.view' });

export const POST = withAuth(async (request, ctx) => {
  if (!warrantyFlagEnabled()) return warrantyFlagOff();
  const id = claimIdFromPath(request, 3);
  if (id == null) return NextResponse.json({ ok: false, error: 'invalid claim id' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const parsed = WarrantyZendeskLinkBody.safeParse(body);
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
    route: 'POST /api/warranty/claims/[id]/zendesk/link',
    bodyKey: parsed.data.idempotencyKey ?? null,
    produce: async () => {
      const claim = await getClaimTicketRef(id, ctx.organizationId);
      if (!claim) return { status: 404, body: { ok: false, error: 'claim not found' } };

      const ticketId = parsed.data.ticketId;

      // One ticket per claim. If a DIFFERENT ticket is already linked, the
      // operator must unlink first — refuse instead of silently swapping.
      // Re-linking the SAME ticket is an idempotent success.
      if (claim.zendeskTicketId && claim.zendeskTicketId !== ticketId) {
        return {
          status: 409,
          body: {
            ok: false,
            error: `claim is already linked to Zendesk ticket #${claim.zendeskTicketId} — unlink it first`,
            ticketId: claim.zendeskTicketId,
            ticketUrl: zendeskTicketUrl(String(claim.zendeskTicketId)),
          },
        };
      }

      let ticket;
      try {
        ticket = await getTicket(ticketId, ctx.organizationId);
      } catch (err) {
        if (err instanceof ZendeskNotConfiguredError) {
          return { status: 503, body: { ok: false, error: 'Zendesk is not configured' } };
        }
        return { status: 502, body: { ok: false, error: err instanceof Error ? err.message : 'Zendesk request failed' } };
      }
      if (!ticket) return { status: 404, body: { ok: false, error: `Zendesk ticket #${ticketId} not found` } };

      // Refuse to steal a ticket that already belongs to a different entity
      // (ticket_links upserts on ticket id, so a blind link would hijack it).
      const existing = await getTicketEntity(ctx.organizationId, ticketId);
      if (existing && !(existing.type === 'WARRANTY_CLAIM' && existing.id === id)) {
        return {
          status: 409,
          body: { ok: false, error: `Ticket #${ticketId} is already linked to another item` },
        };
      }

      await recordClaimTicketLink({
        claimId: id,
        zendeskTicketId: ticketId,
        organizationId: ctx.organizationId,
        actorStaffId: ctx.staffId ?? null,
        eventType: 'ZENDESK_LINKED',
      });

      // Backfill external_id only when the ticket has none — ticket_links wins
      // for resolution, so never clobber a value another system set.
      if (!ticket.external_id) {
        try {
          await updateTicket(ticketId, { external_id: buildExternalId('WARRANTY_CLAIM', id) }, ctx.organizationId);
        } catch (extErr) {
          console.warn('[POST .../zendesk/link] external_id backfill failed', extErr);
        }
      }

      await recordAudit(pool, ctx, request, {
        source: 'warranty-logger',
        action: 'warranty.zendesk_link',
        entityType: 'warranty_claim',
        entityId: id,
        after: { zendeskTicketId: ticketId },
      });

      return {
        status: 200,
        body: {
          ok: true,
          ticketId,
          ticketUrl: zendeskTicketUrl(String(ticketId)),
          subject: ticket.subject ?? null,
        },
      };
    },
  });
}, { permission: 'warranty.manage' });

export const DELETE = withAuth(async (request, ctx) => {
  if (!warrantyFlagEnabled()) return warrantyFlagOff();
  const id = claimIdFromPath(request, 3);
  if (id == null) return NextResponse.json({ ok: false, error: 'invalid claim id' }, { status: 400 });

  const ticketIdRaw = request.nextUrl.searchParams.get('ticketId');
  const ticketId = Number(ticketIdRaw);
  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    return NextResponse.json({ ok: false, error: 'ticketId is required' }, { status: 400 });
  }

  try {
    const claim = await getClaimTicketRef(id, ctx.organizationId);
    if (!claim) return NextResponse.json({ ok: false, error: 'claim not found' }, { status: 404 });

    const { detached } = await unlinkClaimTicket({
      claimId: id,
      zendeskTicketId: ticketId,
      organizationId: ctx.organizationId,
      actorStaffId: ctx.staffId ?? null,
    });

    await recordAudit(pool, ctx, request, {
      source: 'warranty-logger',
      action: 'warranty.zendesk_unlink',
      entityType: 'warranty_claim',
      entityId: id,
      before: { zendeskTicketId: ticketId },
      after: { zendeskTicketId: null },
    });

    return NextResponse.json({ ok: true, detached });
  } catch (err) {
    if (err instanceof ZendeskNotConfiguredError) return ZENDESK_NOT_CONFIGURED;
    const message = err instanceof Error ? err.message : 'zendesk unlink failed';
    console.error('[DELETE /api/warranty/claims/[id]/zendesk/link] error:', err);
    const status = err instanceof ZendeskApiError ? 502 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}, { permission: 'warranty.manage' });
