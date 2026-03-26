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
 */

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type ScanCarrier =
  | 'UPS'
  | 'FEDEX'
  | 'USPS'
  | 'DHL_EXPRESS'
  | 'DHL_ECOMMERCE'
  | 'AMAZON'
  | 'UPU_INTL'
  | 'ONTRAC'
  | 'LASERSHIP'
  | 'GSO';

export type ClassifiedScanType = 'tracking' | 'serial_full' | 'serial_partial' | 'unknown';

export interface ClassifyResult {
  type: ClassifiedScanType;
  carrier: ScanCarrier | null;
  /** Upper-cased, non-alphanumeric-stripped value used for pattern matching. */
  normalized: string;
}

export interface SerialMatchResult {
  matchType: 'exact' | 'suffix' | 'contains' | 'none';
  matches: string[];
}

// ─── TRACKING NUMBER PATTERNS ────────────────────────────────────────────────
//
//  Patterns are tested in order against the normalised (A-Z0-9 only) input.
//  More-specific patterns are listed first to prevent false positives from
//  broader numeric rules.

const TRACKING_PATTERNS: ReadonlyArray<{ carrier: ScanCarrier; regex: RegExp }> = [
  // UPS — 1Z + 16 alphanumeric chars (18 total)
  { carrier: 'UPS',           regex: /^1Z[A-Z0-9]{16}$/ },

  // Extended FedEx long labels seen in station scans (33–34 digits, 9621…)
  { carrier: 'FEDEX',         regex: /^9621\d{29,30}$/ },

  // Explicit 12-digit short tracking example used at station (399…)
  { carrier: 'FEDEX',         regex: /^399\d{9}$/ },

  // FedEx — 12 / 15 / 20 pure digits OR 96XXXXXXXXXX (22) OR 1[456789]XXXXXXXXXXXXXX (16)
  // Note: generic 22-digit matching was removed to avoid swallowing USPS IMpb
  // labels such as 9300... which should classify as USPS.
  { carrier: 'FEDEX',         regex: /^(96\d{20}|1[456789]\d{14}|\d{20}|\d{15}|\d{12})$/ },

  // USPS — IMpb starts 9XXXX (various lengths 16-22) or pure-digit 20-22
  { carrier: 'USPS',          regex: /^(9[2345][0-9]{18,20}|9[0-9]{15,21}|[0-9]{20,22})$/ },

  // DHL eCommerce — JD + 18 digits (20 total)
  { carrier: 'DHL_ECOMMERCE', regex: /^JD\d{18}$/ },

  // DHL Express — 10 or 11 pure digits
  { carrier: 'DHL_EXPRESS',   regex: /^\d{10,11}$/ },

  // Amazon Logistics — TBA + 12 digits
  { carrier: 'AMAZON',        regex: /^TBA\d{12}$/ },

  // UPU international postal — 2 letters + 9 digits + 2 letters  (e.g. LZ123456789US)
  { carrier: 'UPU_INTL',      regex: /^[A-Z]{2}\d{9}[A-Z]{2}$/ },

  // OnTrac — C + 14 digits (15 total)
  { carrier: 'ONTRAC',        regex: /^C\d{14}$/ },

  // LaserShip — 1LS + 12 digits (15 total)
  { carrier: 'LASERSHIP',     regex: /^1LS\d{12}$/ },

  // GSO — 2 letters + 14 digits (16 total)
  { carrier: 'GSO',           regex: /^[A-Z]{2}\d{14}$/ },
];

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
 * Amazon FNSKU (X0 + 8) or ASIN (B0 + 8). Exactly 10 A-Z/0-9 characters.
 * Normalized before matching so scanner punctuation does not break detection.
 *
 * FNSKUs in this app are treated as the broader X0... family, not just X00...,
 * because live station scans include values like X004MW2DMB.
 */
export const FNSKU_OR_ASIN_REGEX = /^(X0[A-Z0-9]{8}|B0[A-Z0-9]{8})$/;

export function looksLikeFnsku(value: string): boolean {
  const v = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return FNSKU_OR_ASIN_REGEX.test(v);
}

/**
 * True while input could still become a valid 10-char FNSKU (X0...) or ASIN (B0...).
 * For station UI mode only — routing to `/api/tech/scan-fnsku` must use {@link looksLikeFnsku} (complete).
 */
export function looksLikeFnskuPrefix(value: string): boolean {
  if (looksLikeFnsku(value)) return true;
  const v = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!v) return false;
  if (/^X0[A-Z0-9]{0,8}$/.test(v) && v.length < 10) return true;
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

  // Anything ≥ 20 chars is definitively too long to be a serial number
  // (serial_full max is 19 chars). Treat as an unrecognised-carrier tracking number.
  if (norm.length >= 20) {
    return { type: 'tracking', carrier: null, normalized: norm };
  }

  // A scan that ends in a digit (no trailing letter suffix) and is ≥ 10 chars
  // is characteristic of a carrier tracking barcode, not a product serial.
  // Serial numbers in this system end with 0–2 uppercase letters.
  if (norm.length >= 10 && /\d$/.test(norm)) {
    return { type: 'tracking', carrier: null, normalized: norm };
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
