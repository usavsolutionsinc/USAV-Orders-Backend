/**
 * Phone normalization for caller matching. The repo had no E.164 helper — only
 * a 10-digit display formatter (`src/utils/phone.ts`) — so this is the matching
 * key SoT for `counterparty_e164`.
 *
 * Scope is intentionally US/NANP-first (the business is domestic): 10-digit →
 * +1XXXXXXXXXX, 11-digit leading 1 → +1…, already-+E.164 passes through. Anything
 * else returns null (don't guess — an unmatched key is safer than a wrong one).
 * If international volume appears, swap the body for `libphonenumber-js` without
 * touching callers.
 */

export function toE164(raw: string | null | undefined, defaultRegion: 'US' = 'US'): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // Already E.164 (+ then 8–15 digits).
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed;

  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (defaultRegion === 'US') {
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  }

  // 8–15 digits with a country code we can't confidently attribute → keep as +digits
  // only when it already looked international (had a leading +). Otherwise bail.
  return null;
}

/** Last-N digits, for fuzzy "ends-with" matching against stored display numbers. */
export function lastDigits(raw: string | null | undefined, n = 10): string {
  if (!raw) return '';
  return String(raw).replace(/\D/g, '').slice(-n);
}
