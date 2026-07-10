/**
 * Wrong-destination v1 — carrier delivered event postal ≠ warehouse ship-from.
 * Soft signal for "seller shipped to the wrong place."
 */

/** Digits-only postal (US ZIP5). Empty if unusable. */
export function normalizePostalCode(raw: string | null | undefined): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 5) return '';
  return digits.slice(0, 5);
}

/**
 * True when both postals are known and differ. Missing either side → false
 * (do not cry wolf when warehouse ship-from is unset).
 */
export function isWrongDestination(
  eventPostal: string | null | undefined,
  warehousePostal: string | null | undefined,
): boolean {
  const a = normalizePostalCode(eventPostal);
  const b = normalizePostalCode(warehousePostal);
  if (!a || !b) return false;
  return a !== b;
}
