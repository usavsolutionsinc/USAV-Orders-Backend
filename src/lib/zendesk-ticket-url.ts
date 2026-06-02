/**
 * Build a deep link to a Zendesk agent ticket from a ticket id or a "#1234"
 * string.
 *
 * Client-safe: it only reads env, so it can be imported from both server
 * routes and `'use client'` components. On the client only
 * NEXT_PUBLIC_ZENDESK_SUBDOMAIN is inlined; on the server we also fall back to
 * ZENDESK_SUBDOMAIN. Both fall back to the known 'usav' workspace so existing
 * deployments get working links without new env config.
 */
export function zendeskTicketUrl(
  ticketId: string | number | null | undefined,
): string | null {
  if (ticketId == null) return null;
  const id = String(ticketId).trim().replace(/^#/, '').trim();
  if (!id) return null;

  // If the value is already a full URL (operators sometimes paste one), use it.
  if (/^https?:\/\//i.test(id)) return id;
  // Only linkify bare numeric ticket ids — free-text notes shouldn't become links.
  if (!/^\d+$/.test(id)) return null;

  const subdomain =
    process.env.NEXT_PUBLIC_ZENDESK_SUBDOMAIN ||
    process.env.ZENDESK_SUBDOMAIN ||
    'usav';
  return `https://${subdomain}.zendesk.com/agent/tickets/${id}`;
}
