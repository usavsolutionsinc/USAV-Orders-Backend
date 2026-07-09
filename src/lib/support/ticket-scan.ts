/**
 * Pure ticket-scan heuristics — client-safe (no DB). Shared by receiving Unbox,
 * header→assistant handoff, and support ticket resolution.
 */

/** True when the entire scan value is a ticket id (#4821 / 4821). */
export function looksLikeTicketScan(value: string): boolean {
  return /^#?\d{1,12}$/.test(value.trim());
}

/** Parse a ticket scan value; null when it does not look like a ticket id. */
export function parseTicketScanValue(value: string): number | null {
  if (!looksLikeTicketScan(value)) return null;
  const digits = value.trim().replace(/^#/, '');
  const n = Number(digits);
  return Number.isInteger(n) && n > 0 ? n : null;
}
