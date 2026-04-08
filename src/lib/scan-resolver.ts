import { normalizeTrackingCanonical } from '@/lib/tracking-format';
import { TRACKING_PATTERNS, type CarrierCode } from '@/utils/carrier-patterns';

/**
 * scan-resolver.ts
 * ─────────────────────────────────────────────────────────────────
 * Dynamic Tracking Number + Serial Number Detection & Cascade Lookup
 *
 * FLOW:
 *   1. Classify input  →  tracking | serial_full | serial_partial | unknown
 *   2. Tracking path   →  lookup order  →  found ✅  |  orders_exceptions ⚠️
 *   3. Serial path     →  append serial to order OR exception record
 *   4. Partial serial  →  suffix match first, contains fallback (≤10 chars)
 * ─────────────────────────────────────────────────────────────────
 *
 * All patterns are applied against the *normalised* input
 * (upper-cased, non-alphanumeric chars stripped).  This mirrors how
 * barcode scanners emit data and avoids hyphens/spaces causing misses.
 *
 * Carrier patterns are imported from utils/carrier-patterns.ts (single
 * source of truth shared with tracking-format.ts).
 */

// ─── TYPES ────────────────────────────────────────────────────────────────────

/** @deprecated Use CarrierCode from '@/utils/carrier-patterns' instead. */
export type ScanCarrier = CarrierCode;

export type ClassifiedScanType = 'tracking' | 'serial_full' | 'serial_partial' | 'unknown';

export interface ClassifyResult {
  type: ClassifiedScanType;
  carrier: CarrierCode | null;
  /** Upper-cased, non-alphanumeric-stripped value used for pattern matching. */
  normalized: string;
}

export interface SerialMatchResult {
  matchType: 'exact' | 'suffix' | 'contains' | 'none';
  matches: string[];
}

// Re-export TRACKING_PATTERNS for any downstream consumers
export { TRACKING_PATTERNS } from '@/utils/carrier-patterns';

// ─── SERIAL NUMBER PATTERNS ───────────────────────────────────────────────────
//
//  Full serial  : 15-17 alphanumeric chars, with an optional 2-letter suffix
//                 e.g. "ABC123456789012XY" (17+2 = 19 chars max)
//  Partial entry: 1-10 alphanumeric chars — suffix / partial scan, or ambiguous
//                 short strings that are not valid carrier tracking (e.g. 9 digits).
//                 e.g. "4A2B", "012XY", "123456789", "ABCDEFGHIJ", "1ZSHORT"

export const SERIAL_FULL_REGEX    = /^[A-Z0-9]{15,17}([A-Z]{2})?$/i;
export const SERIAL_PARTIAL_REGEX = /^[A-Z0-9]{1,10}$/i;

/**
 * Amazon FNSKU (X00 + 7) or ASIN (B0 + 8). Exactly 10 A-Z/0-9 characters.
 * Normalized before matching so scanner punctuation does not break detection.
 */
export const FNSKU_OR_ASIN_REGEX = /^(X00[A-Z0-9]{7}|B0[A-Z0-9]{8})$/;

export function looksLikeFnsku(value: string): boolean {
  const v = normalizeTrackingCanonical(value);
  return FNSKU_OR_ASIN_REGEX.test(v);
}

/**
 * True while input could still become a valid 10-char FNSKU (X00...) or ASIN (B0...).
 * For station UI mode only — routing to `/api/tech/scan-fnsku` must use {@link looksLikeFnsku} (complete).
 */
export function looksLikeFnskuPrefix(value: string): boolean {
  if (looksLikeFnsku(value)) return true;
  const v = normalizeTrackingCanonical(value);
  if (!v) return false;
  if (/^X00[A-Z0-9]{0,7}$/.test(v) && v.length < 10) return true;
  if (/^B0[A-Z0-9]{0,8}$/.test(v) && v.length < 10) return true;
  return false;
}

// ─── CLASSIFIER ───────────────────────────────────────────────────────────────

/**
 * classifyInput(raw)
 *
 * Returns { type, carrier, normalized }.
 * Strips internal whitespace and non-alphanumeric chars before testing
 * tracking patterns; preserves original case for serial patterns.
 */
export function classifyInput(raw: string): ClassifyResult {
  const stripped = raw.trim().replace(/\s+/g, '');
  if (!stripped) return { type: 'unknown', carrier: null, normalized: '' };

  // Normalise for carrier pattern matching (uppercase, alphanumeric only)
  const norm = stripped.toUpperCase().replace(/[^A-Z0-9]/g, '');

  for (const { carrier, regex } of TRACKING_PATTERNS) {
    if (regex.test(norm)) {
      return { type: 'tracking', carrier, normalized: norm };
    }
  }

  // Anything ≥ 20 chars that doesn't match a carrier pattern is unknown.
  // Station routing should then default this to SERIAL unless another
  // explicit station regex handles it.
  if (norm.length >= 20) {
    return { type: 'unknown', carrier: null, normalized: norm };
  }

  // Do not auto-promote generic numeric values to tracking; unmatched values
  // should fall through to serial/unknown handling.
  if (norm.length >= 10 && /\d$/.test(norm)) {
    return { type: 'unknown', carrier: null, normalized: norm };
  }

  // Full serial (15-19 chars with optional 2-letter suffix)
  if (SERIAL_FULL_REGEX.test(stripped)) {
    return { type: 'serial_full', carrier: null, normalized: stripped.toUpperCase() };
  }

  // Partial/manual serial entry (1-10 chars)
  if (SERIAL_PARTIAL_REGEX.test(stripped)) {
    return { type: 'serial_partial', carrier: null, normalized: stripped.toUpperCase() };
  }

  return { type: 'unknown', carrier: null, normalized: norm };
}

// ─── SERIAL MATCHER ───────────────────────────────────────────────────────────

/**
 * findSerialInCatalog(input, serialCatalog)
 *
 * Matches a scanned partial or full serial against a list of known full serials.
 *
 * Strategy (in priority order):
 *   1. Exact   — normalised input equals a catalog entry
 *   2. Suffix  — catalog entry ends with the input  (partial suffix scan)
 *   3. Contains — catalog entry contains the input   (substring fallback)
 *
 * Returns all matches so the caller can surface ambiguous results to the user.
 */
export function findSerialInCatalog(input: string, serialCatalog: string[]): SerialMatchResult {
  const q = input.toUpperCase();

  const exact = serialCatalog.filter(s => s.toUpperCase() === q);
  if (exact.length) return { matchType: 'exact', matches: exact };

  const suffix = serialCatalog.filter(s => s.toUpperCase().endsWith(q));
  if (suffix.length) return { matchType: 'suffix', matches: suffix };

  const contains = serialCatalog.filter(s => s.toUpperCase().includes(q));
  if (contains.length) return { matchType: 'contains', matches: contains };

  return { matchType: 'none', matches: [] };
}
