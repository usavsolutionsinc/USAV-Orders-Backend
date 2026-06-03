/**
 * Local pickup PO number helpers.
 *
 * A finalized local pickup becomes a Zoho Purchase Order numbered
 * `LCPU-{NAME}-{MMDDYY}` (e.g. `LCPU-KEN-060326`). NAME is the operator-typed
 * pickup name (uppercased, alphanumerics only). These are pure functions so the
 * client (review preview + receiving tracking) and the server (finalize → Zoho)
 * derive byte-identical numbers from the same inputs.
 */

/** Uppercase + strip everything but A–Z/0–9 (e.g. "Ken's Pickup" → "KENSPICKUP"). */
export function slugifyPickupName(name: string): string {
  return String(name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

/** `YYYY-MM-DD` → `MMDDYY`. Returns '' for an unparseable date. */
export function formatPickupDateMMDDYY(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateKey || ''));
  if (!m) return '';
  return `${m[2]}${m[3]}${m[1].slice(2)}`;
}

/** `LCPU-{slug(name)}-{MMDDYY(dateKey)}`. */
export function buildLocalPickupPoNumber(name: string, dateKey: string): string {
  return `LCPU-${slugifyPickupName(name)}-${formatPickupDateMMDDYY(dateKey)}`;
}
