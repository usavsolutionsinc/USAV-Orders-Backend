/**
 * Shared "link an existing Zendesk ticket" candidate resolution.
 *
 * Every surface that links an EXISTING ticket to an internal entity (receiving
 * carton/line, warranty claim, …) needs the same three behaviours:
 *   • no query        → most recent tickets (newest first)
 *   • "#1234" / "1234" → direct id lookup (the manual-entry path)
 *   • anything else    → Zendesk search
 * …and the same "hide tickets already linked to a DIFFERENT entity" rule, with
 * a ticket linked to THIS entity flagged `linkedToThis` so the UI shows it as
 * done. Centralising it here keeps the receiving and warranty link routes from
 * drifting into parallel implementations (the manual-id path must behave
 * identically to a list pick on every surface).
 */
import pool from '@/lib/db';
import {
  getTicket,
  listTickets,
  searchTickets,
  type ZendeskTicket,
} from '@/lib/zendesk';
import { parseExternalId } from '@/lib/zendesk-links';
import { zendeskTicketUrl } from '@/lib/zendesk-ticket-url';

export interface TicketLinkCandidate {
  id: number;
  subject: string | null;
  description: string | null;
  status: string;
  priority: string | null;
  createdAt: string;
  updatedAt: string;
  url: string | null;
  /** True when this ticket is already linked to the requesting entity. */
  linkedToThis: boolean;
}

export async function listTicketLinkCandidates(args: {
  orgId: string;
  entityType: string;
  entityId: number;
  query?: string | null;
  perPage?: number;
}): Promise<{ tickets: TicketLinkCandidate[]; hiddenLinked: number }> {
  const perPage = args.perPage ?? 20;
  const query = (args.query ?? '').trim();
  // A bare "#1234" / "1234" is a direct ticket lookup — this is what makes
  // manual typed-id entry resolve identically to picking from the list.
  const idMatch = /^#?(\d{1,12})$/.exec(query);

  let tickets: ZendeskTicket[];
  if (!query) {
    tickets = (await listTickets({ perPage })).tickets;
  } else if (idMatch) {
    const ticket = await getTicket(Number(idMatch[1]));
    tickets = ticket ? [ticket] : [];
  } else {
    tickets = (await searchTickets(query, { perPage })).results;
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
      [args.orgId, ids],
    );
    for (const row of links.rows) {
      linkByTicket.set(Number(row.zendesk_ticket_id), { type: row.entity_type, id: Number(row.entity_id) });
    }
    const overlay = await pool.query<{ zendesk_ticket_id: string; source_kind: string; source_id: string }>(
      `SELECT zendesk_ticket_id, source_kind, source_id FROM unfound_overlay
        WHERE organization_id = $1
          AND zendesk_ticket_id = ANY($2::text[])`,
      [args.orgId, ids.flatMap((id) => [String(id), `#${id}`])],
    );
    for (const row of overlay.rows) {
      const ticketId = Number(String(row.zendesk_ticket_id).replace(/^#/, ''));
      if (linkByTicket.has(ticketId)) continue;
      const isReceiving = row.source_kind === 'unmatched_receiving' && /^\d+$/.test(row.source_id);
      linkByTicket.set(
        ticketId,
        isReceiving ? { type: 'RECEIVING', id: Number(row.source_id) } : { type: 'UNFOUND', id: 0 },
      );
    }
  }

  let hiddenLinked = 0;
  const out: TicketLinkCandidate[] = [];
  for (const t of tickets) {
    const link = linkByTicket.get(t.id) ?? parseExternalId(t.external_id as string | undefined);
    const linkedToThis = !!link && link.type === args.entityType && link.id === args.entityId;
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

  return { tickets: out, hiddenLinked };
}
