import type { ZendeskAgent, ZendeskComment, ZendeskTicket, ZendeskUser } from '@/lib/zendesk';

/**
 * Best-effort requester identity. Email-channel tickets carry the customer on
 * `via.source.from.{name,address}` (the same field the dashboard overview uses);
 * there's no separate end-user fetch, so we read it off the ticket.
 */
export function requesterFrom(ticket: ZendeskTicket): { name: string | null; email: string | null } {
  const via = (ticket as { via?: { source?: { from?: { name?: string; address?: string } } } }).via;
  const from = via?.source?.from;
  return { name: from?.name ?? null, email: from?.address ?? null };
}

export function requesterLabel(ticket: ZendeskTicket): string {
  const r = requesterFrom(ticket);
  return r.name || r.email || 'Requester';
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

export interface ResolvedAuthor {
  /** Best display name (agent/user name, or the email, or the requester label). */
  name: string;
  /** The author's email when known (from the agent/user roster) — never an id. */
  email: string | null;
  /** Avatar photo URL when the roster has one. */
  photo: string | null;
  /** True when this comment is one of OURS (agent reply or any internal note). */
  isOurs: boolean;
}

/**
 * Resolve a comment author to a name + email, never a bare "User #<id>".
 * Order: Zendesk agent roster → Zendesk user roster (requester / end users) →
 * the ticket requester identity → email-only → last-resort id.
 *
 * `isOurs` drives right-side placement: a comment is ours if its author is an
 * agent, OR it's a non-public internal note, OR it's our optimistic echo.
 */
export function resolveAuthor(
  c: ZendeskComment,
  maps: {
    agentsById: Map<number, ZendeskAgent>;
    usersById: Map<number, ZendeskUser>;
    requesterId?: number;
    requesterName?: string | null;
    requesterEmail?: string | null;
  },
): ResolvedAuthor {
  const agent = maps.agentsById.get(c.author_id);
  const user = maps.usersById.get(c.author_id);
  const optimisticOurs = (c as { __ours?: boolean }).__ours === true;

  // Prefer identity the comments route already resolved server-side (from the
  // zendesk_users cache + agent roster) — present on first paint, so no flicker.
  const server = c as {
    author_name?: string;
    author_email?: string | null;
    author_photo?: string | null;
    author_is_agent?: boolean;
  };
  if (server.author_name) {
    return {
      name: server.author_name,
      email: server.author_email ?? null,
      photo: server.author_photo ?? null,
      isOurs: Boolean(server.author_is_agent) || c.public === false || optimisticOurs,
    };
  }

  const isOurs = Boolean(agent) || c.public === false || optimisticOurs;

  if (agent) {
    return { name: agent.name, email: agent.email, photo: agent.photo, isOurs };
  }
  if (user) {
    return { name: user.name || user.email || 'User', email: user.email, photo: user.photo, isOurs };
  }
  if (maps.requesterId && c.author_id === maps.requesterId) {
    const name = maps.requesterName || maps.requesterEmail || 'Requester';
    return { name, email: maps.requesterEmail ?? null, photo: null, isOurs };
  }
  if (optimisticOurs) {
    return { name: 'You', email: null, photo: null, isOurs };
  }
  return { name: `User #${c.author_id}`, email: null, photo: null, isOurs };
}
