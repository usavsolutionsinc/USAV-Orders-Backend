/** Numeric Zendesk id from "#1234", "1234", or a tickets/1234 URL. */
export function parseZendeskTicketId(raw: string | null | undefined): number | null {
  if (!raw?.trim()) return null;
  const fromUrl = raw.match(/tickets\/(\d+)/);
  const digits = (fromUrl ? fromUrl[1] : raw.replace(/^#/, '')).match(/\d+/);
  if (!digits) return null;
  const n = Number(digits[0]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** True when a saved seller draft belongs to the currently selected/filed ticket. */
export function sellerDraftMatchesTicket(
  savedTicketId: number | null | undefined,
  currentTicketId: number | null | undefined,
  currentTicketNumber?: string | null,
): boolean {
  if (currentTicketId != null && savedTicketId != null) {
    return savedTicketId === currentTicketId;
  }
  if (currentTicketNumber?.trim()) {
    const parsed = parseZendeskTicketId(currentTicketNumber);
    if (parsed != null && savedTicketId != null) return savedTicketId === parsed;
  }
  return false;
}
