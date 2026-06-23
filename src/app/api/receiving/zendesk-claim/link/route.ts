import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import {
  getTicket,
  updateTicket,
  ZendeskNotConfiguredError,
} from '@/lib/zendesk';
import {
  buildExternalId,
  clearTicketExternalIdIfMatches,
  getTicketEntity,
  linkTicket,
  unlinkTicket,
} from '@/lib/zendesk-links';
import { listTicketLinkCandidates } from '@/lib/zendesk-link-candidates';
import { zendeskTicketUrl } from '@/lib/zendesk-ticket-url';
import { tenantQuery } from '@/lib/tenancy/db';
import { USAV_ORG_ID } from '@/lib/tenancy/constants';

export const dynamic = 'force-dynamic';

/**
 * Link an EXISTING Zendesk ticket to a receiving carton/line (the counterpart
 * to POST /api/receiving/zendesk-claim, which creates a fresh ticket).
 *
 *   GET  ?receivingId=N[&lineId=N][&query=...] → link candidates. Without a
 *        query this is the most recent tickets (the common case: the claim
 *        was just filed by email, so it's near the top); with one it's a
 *        Zendesk search (or a direct id lookup for "#1234"). Either way,
 *        tickets already linked to a DIFFERENT entity (ticket_links /
 *        external_id / unfound_overlay) are hidden. A ticket already linked
 *        to THIS entity is returned flagged `linkedToThis` so the UI can show
 *        it as done.
 *   POST { receivingId, lineId?, ticketId } → write the link: ticket_links
 *        upsert + external_id backfill + zendesk_ticket column, mirroring the
 *        create route's post-create steps.
 */

function notConfigured(context: string): NextResponse {
  return errorResponse(
    new ApiError(503, 'Zendesk is not configured', 'Set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL and ZENDESK_API_TOKEN.'),
    context,
  );
}

function entityRef(receivingId: number, lineId: number | null | undefined) {
  return lineId != null
    ? { entityType: 'RECEIVING_LINE', entityId: lineId }
    : { entityType: 'RECEIVING', entityId: receivingId };
}

const SearchQuery = z.object({
  query: z.string().trim().optional(),
  receivingId: z.coerce.number().int().positive(),
  lineId: z.coerce.number().int().positive().optional(),
});

export const GET = withAuth(async (req: NextRequest, ctx) => {
  const context = 'GET /api/receiving/zendesk-claim/link';
  try {
    const sp = req.nextUrl.searchParams;
    const parsed = SearchQuery.parse({
      query: sp.get('query') ?? undefined,
      receivingId: sp.get('receivingId') ?? undefined,
      lineId: sp.get('lineId') ?? undefined,
    });
    const { entityType, entityId } = entityRef(parsed.receivingId, parsed.lineId);

    // Recent / search / direct-#id candidates with "linked elsewhere" hidden —
    // shared with the warranty link route so manual-id entry behaves identically
    // on both surfaces (see listTicketLinkCandidates).
    const { tickets, hiddenLinked } = await listTicketLinkCandidates({
      orgId: ctx.organizationId,
      entityType,
      entityId,
      query: parsed.query,
    });

    return NextResponse.json({ success: true, tickets, hiddenLinked });
  } catch (err) {
    if (err instanceof ZendeskNotConfiguredError) return notConfigured(context);
    return errorResponse(err, context);
  }
}, { permission: 'receiving.mark_received' });

const LinkBody = z.object({
  receivingId: z.number().int().positive(),
  lineId: z.number().int().positive().nullable().optional(),
  ticketId: z.number().int().positive(),
});

export const POST = withAuth(async (req: NextRequest, ctx) => {
  const context = 'POST /api/receiving/zendesk-claim/link';
  try {
    const body = LinkBody.parse(await req.json().catch(() => null));
    const { entityType, entityId } = entityRef(body.receivingId, body.lineId);

    const ticket = await getTicket(body.ticketId);
    if (!ticket) throw ApiError.notFound('Zendesk ticket', body.ticketId);

    // One entity per ticket (ticket_links upserts on ticket id), so linking a
    // ticket that already belongs to another carton/line would silently steal
    // it. Refuse instead — the operator picked the wrong ticket.
    const existing = await getTicketEntity(ctx.organizationId, body.ticketId);
    if (existing && !(existing.type === entityType && existing.id === entityId)) {
      throw ApiError.conflict(`Ticket #${body.ticketId} is already linked to another item`);
    }

    await linkTicket({
      orgId: ctx.organizationId,
      zendeskTicketId: ticket.id,
      entityType,
      entityId,
      staffId: ctx.staffId,
    });

    // Backfill external_id only when the ticket has none — never clobber a
    // value some other system put there (ticket_links wins for resolution
    // anyway).
    if (!ticket.external_id) {
      try {
        await updateTicket(ticket.id, { external_id: buildExternalId(entityType, entityId) });
      } catch (extErr) {
        console.warn(`[${context}] external_id backfill failed`, extErr);
      }
    }

    // Persist the human-visible ticket # onto the record, same as the create
    // route, so the header pill / Support section pick it up. Best-effort.
    const ticketNumber = `#${ticket.id}`;
    const orgId = ctx.organizationId ?? USAV_ORG_ID;
    try {
      if (body.lineId != null) {
        await tenantQuery(orgId, `UPDATE receiving_lines SET zendesk_ticket = $1 WHERE id = $2`, [ticketNumber, body.lineId]);
      } else {
        await tenantQuery(orgId, `UPDATE receiving SET zendesk_ticket = $1 WHERE id = $2`, [ticketNumber, body.receivingId]);
      }
    } catch (colErr) {
      console.warn(`[${context}] zendesk_ticket column update failed`, colErr);
    }

    return NextResponse.json({
      success: true,
      ticketNumber,
      ticketUrl: zendeskTicketUrl(ticket.id),
      subject: ticket.subject ?? null,
    });
  } catch (err) {
    if (err instanceof ZendeskNotConfiguredError) return notConfigured(context);
    return errorResponse(err, context);
  }
}, { permission: 'receiving.mark_received' });

const UnlinkQuery = z.object({
  receivingId: z.coerce.number().int().positive(),
  lineId: z.coerce.number().int().positive().optional(),
  ticketId: z.coerce.number().int().positive(),
});

/**
 * DELETE ?receivingId=N[&lineId=N]&ticketId=N — detach a linked ticket from the
 * carton/line. Removes the ticket_links row (entity-scoped, so a stale unlink
 * can't steal a re-linked ticket) and clears the zendesk_ticket column. The
 * Zendesk ticket itself is never touched — unlinking only severs our reference.
 */
export const DELETE = withAuth(async (req: NextRequest, ctx) => {
  const context = 'DELETE /api/receiving/zendesk-claim/link';
  try {
    const sp = req.nextUrl.searchParams;
    const parsed = UnlinkQuery.parse({
      receivingId: sp.get('receivingId') ?? undefined,
      lineId: sp.get('lineId') ?? undefined,
      ticketId: sp.get('ticketId') ?? undefined,
    });
    const { entityType, entityId } = entityRef(parsed.receivingId, parsed.lineId);

    const removed = await unlinkTicket({
      orgId: ctx.organizationId,
      zendeskTicketId: parsed.ticketId,
      entityType,
      entityId,
    });

    // Clear the dangling external_id off the Zendesk ticket (only when it still
    // resolves to this entity) so getTicketEntity can't re-attach it via the
    // external_id fallback after the ticket_links row is gone. Mirrors the
    // warranty unlink — full clean detach.
    await clearTicketExternalIdIfMatches({
      zendeskTicketId: parsed.ticketId,
      entityType,
      entityId,
    });

    // Clear the human-visible ticket # from the record so the chip flips back to
    // the Claim affordance. Best-effort; only clears when it still matches.
    const ticketNumber = `#${parsed.ticketId}`;
    const orgId = ctx.organizationId ?? USAV_ORG_ID;
    try {
      if (parsed.lineId != null) {
        await tenantQuery(
          orgId,
          `UPDATE receiving_lines SET zendesk_ticket = NULL WHERE id = $1 AND zendesk_ticket = $2`,
          [parsed.lineId, ticketNumber],
        );
      } else {
        await tenantQuery(
          orgId,
          `UPDATE receiving SET zendesk_ticket = NULL WHERE id = $1 AND zendesk_ticket = $2`,
          [parsed.receivingId, ticketNumber],
        );
      }
    } catch (colErr) {
      console.warn(`[${context}] zendesk_ticket column clear failed`, colErr);
    }

    return NextResponse.json({ success: true, removed });
  } catch (err) {
    if (err instanceof ZendeskNotConfiguredError) return notConfigured(context);
    return errorResponse(err, context);
  }
}, { permission: 'receiving.mark_received' });
