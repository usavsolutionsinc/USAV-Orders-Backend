import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, errorResponse } from '@/lib/api';
import { withAuth } from '@/lib/auth/withAuth';
import {
  getTicket,
  listTickets,
  searchTickets,
  updateTicket,
  ZendeskNotConfiguredError,
  type ZendeskTicket,
} from '@/lib/zendesk';
import {
  buildExternalId,
  getTicketEntity,
  linkTicket,
  parseExternalId,
  unlinkTicket,
} from '@/lib/zendesk-links';
import { zendeskTicketUrl } from '@/lib/zendesk-ticket-url';
import pool from '@/lib/db';

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

    // No query → most recent tickets (newest first). A bare "#1234" / "1234"
    // is a direct ticket lookup; anything else goes through Zendesk search.
    let tickets: ZendeskTicket[];
    const query = parsed.query ?? '';
    const idMatch = /^#?(\d{1,12})$/.exec(query);
    if (!query) {
      tickets = (await listTickets({ perPage: 20 })).tickets;
    } else if (idMatch) {
      const ticket = await getTicket(Number(idMatch[1]));
      tickets = ticket ? [ticket] : [];
    } else {
      tickets = (await searchTickets(query, { perPage: 20 })).results;
    }

    // Resolve existing links for the whole result page in two bulk queries
    // (ticket_links is authoritative; unfound_overlay stores the id as text,
    // sometimes "#"-prefixed). external_id rides along on the search payload.
    const ids = tickets.map((t) => t.id);
    const linkByTicket = new Map<number, { type: string; id: number }>();
    if (ids.length > 0) {
      const links = await pool.query<{ zendesk_ticket_id: string; entity_type: string; entity_id: string }>(
        `SELECT zendesk_ticket_id, entity_type, entity_id FROM ticket_links
          WHERE organization_id = $1 AND zendesk_ticket_id = ANY($2::bigint[])`,
        [ctx.organizationId, ids],
      );
      for (const row of links.rows) {
        linkByTicket.set(Number(row.zendesk_ticket_id), { type: row.entity_type, id: Number(row.entity_id) });
      }
      const overlay = await pool.query<{ zendesk_ticket_id: string; source_kind: string; source_id: string }>(
        `SELECT zendesk_ticket_id, source_kind, source_id FROM unfound_overlay
          WHERE organization_id = $1
            AND zendesk_ticket_id = ANY($2::text[])`,
        [ctx.organizationId, ids.flatMap((id) => [String(id), `#${id}`])],
      );
      for (const row of overlay.rows) {
        const ticketId = Number(String(row.zendesk_ticket_id).replace(/^#/, ''));
        if (linkByTicket.has(ticketId)) continue;
        const isReceiving = row.source_kind === 'unmatched_receiving' && /^\d+$/.test(row.source_id);
        linkByTicket.set(
          ticketId,
          isReceiving
            ? { type: 'RECEIVING', id: Number(row.source_id) }
            : { type: 'UNFOUND', id: 0 },
        );
      }
    }

    let hiddenLinked = 0;
    const out: Array<{
      id: number;
      subject: string | null;
      description: string | null;
      status: string;
      priority: string | null;
      createdAt: string;
      updatedAt: string;
      url: string | null;
      linkedToThis: boolean;
    }> = [];
    for (const t of tickets) {
      const link = linkByTicket.get(t.id) ?? parseExternalId(t.external_id as string | undefined);
      const linkedToThis = !!link && link.type === entityType && link.id === entityId;
      if (link && !linkedToThis) {
        hiddenLinked++;
        continue;
      }
      out.push({
        id: t.id,
        subject: t.subject ?? null,
        // First comment body — enough for the expanded preview row; capped so
        // a long email thread doesn't bloat the list payload.
        description: typeof t.description === 'string' ? t.description.slice(0, 600) : null,
        status: String(t.status ?? ''),
        priority: t.priority ? String(t.priority) : null,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        url: zendeskTicketUrl(t.id),
        linkedToThis,
      });
    }

    return NextResponse.json({ success: true, tickets: out, hiddenLinked });
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
    try {
      if (body.lineId != null) {
        await pool.query(`UPDATE receiving_lines SET zendesk_ticket = $1 WHERE id = $2`, [ticketNumber, body.lineId]);
      } else {
        await pool.query(`UPDATE receiving SET zendesk_ticket = $1 WHERE id = $2`, [ticketNumber, body.receivingId]);
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

    // Clear the human-visible ticket # from the record so the chip flips back to
    // the Claim affordance. Best-effort; only clears when it still matches.
    const ticketNumber = `#${parsed.ticketId}`;
    try {
      if (parsed.lineId != null) {
        await pool.query(
          `UPDATE receiving_lines SET zendesk_ticket = NULL WHERE id = $1 AND zendesk_ticket = $2`,
          [parsed.lineId, ticketNumber],
        );
      } else {
        await pool.query(
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
