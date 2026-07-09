/** Internal repair row code (RS-74, RS-0074) — not shown on customer paperwork. */
export function isRsDisplayCode(value: string): boolean {
  return /^RS-?\d+$/i.test(value.trim());
}

/**
 * Customer-facing Zendesk ticket for repair service paper.
 * Returns empty when the value is missing or an RS- internal code.
 */
export function formatRepairPaperTicketNumber(ticketNumber?: string | number | null): string {
  const raw = String(ticketNumber ?? '').trim();
  if (!raw || isRsDisplayCode(raw)) return '';
  if (/^https?:\/\//i.test(raw)) return raw;

  const withoutHash = raw.replace(/^#/, '').trim();
  if (/^\d+$/.test(withoutHash)) return `#${withoutHash}`;
  return raw.startsWith('#') ? raw : raw;
}

/** Intake chrome label — Zendesk ticket only, never RS- internal codes. */
export function formatRepairSubmittedChromeLabel(
  zendeskTicketNumber?: string | number | null,
): string {
  return formatRepairPaperTicketNumber(zendeskTicketNumber) || 'Repair submitted';
}
