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
 * For station UI mode only — routing to `/api/tech/scan` must use {@link looksLikeFnsku} (complete).
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

// ─── GS1 DIGITAL LINK + INTERNAL URL PARSER ──────────────────────────────────
//
// Recognizes scans that come in as URLs (printed QR codes on unit/bin/package
// labels, customer-facing GS1 Digital Link tags, etc.) and resolves them to a
// typed entity descriptor BEFORE the legacy `classifyInput` cascade.
//
// Patterns recognized:
//   /01/{gtin}/21/{serial}         — GS1 Digital Link (unit-level)
//   /01/{gtin}/10/{lot}            — GS1 lot (no serial)
//   /01/{gtin}                     — GS1 product-level
//   /l/{location_id_or_barcode}    — Internal bin/location
//   /p/{tracking_number}           — Internal package (carrier tracking)
//   /o/{order_id}                  — Internal order
//   /s/{sku}                       — Internal SKU stock page
//   /q/{anything}                  — Internal generic QR landing
//
// Returns null when the input is not a URL or the path prefix is unknown, so
// callers can fall through to `classifyInput` without any branching cost.

/**
 * Result of parsing a scanned URL. Discriminated by `type`; never returned
 * with `type: 'unknown'` — callers check for `null` and proceed to the legacy
 * pattern classifier.
 */
export type ScannedUrlEntity =
  | { type: 'unit'; gtin: string; unitSerial: string; url: string }
  | { type: 'gs1_lot'; gtin: string; lot: string; url: string }
  | { type: 'gs1_product'; gtin: string; url: string }
  | { type: 'location'; locationRef: string; url: string }
  | { type: 'package'; trackingNumber: string; url: string }
  | { type: 'order'; orderId: string; url: string }
  | { type: 'stock'; sku: string; url: string }
  | { type: 'generic'; payload: string; url: string };

/**
 * Parse a scanned URL into a typed entity descriptor. Returns null for
 * non-URL inputs or unrecognized path shapes — callers should then fall
 * back to {@link classifyInput}.
 *
 * Tolerant of trailing slashes, query strings, and mixed-case schemes. Does
 * NOT validate GTIN check digits or DB existence; callers do that after
 * resolving to an entity.
 */
export function parseScannedUrl(raw: string): ScannedUrlEntity | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;

  // Quick reject for things that obviously aren't URLs. A printed QR may
  // omit the scheme on some scanners ("inv.example.com/01/...") so accept
  // either a scheme-prefixed URL or a path-only fragment that starts with
  // a known prefix.
  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://placeholder.invalid${trimmed.startsWith('/') ? '' : '/'}${trimmed}`);
  } catch {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  // GS1 Digital Link: /01/{gtin}[/21/{serial} | /10/{lot}]
  if (segments[0] === '01' && segments[1]) {
    const gtin = segments[1];
    // /01/{gtin}/21/{serial}
    if (segments[2] === '21' && segments[3]) {
      return { type: 'unit', gtin, unitSerial: decodeURIComponent(segments[3]), url: url.toString() };
    }
    // /01/{gtin}/10/{lot}
    if (segments[2] === '10' && segments[3]) {
      return { type: 'gs1_lot', gtin, lot: decodeURIComponent(segments[3]), url: url.toString() };
    }
    // /01/{gtin} — product-level only
    return { type: 'gs1_product', gtin, url: url.toString() };
  }

  // Internal short prefixes — single-segment payload.
  const payload = segments[1] ? decodeURIComponent(segments[1]) : '';
  switch (segments[0]) {
    case 'l':
      return payload ? { type: 'location', locationRef: payload, url: url.toString() } : null;
    case 'p':
      return payload ? { type: 'package', trackingNumber: payload, url: url.toString() } : null;
    case 'o':
      return payload ? { type: 'order', orderId: payload, url: url.toString() } : null;
    case 's':
      return payload ? { type: 'stock', sku: payload, url: url.toString() } : null;
    case 'q':
      return payload ? { type: 'generic', payload, url: url.toString() } : null;
    default:
      return null;
  }
}

/**
 * Encode a GTIN + unit serial as a GS1 Digital Link URL. Pair with
 * {@link parseScannedUrl} for roundtrip.
 *
 * Origin is the public-facing base URL (e.g. https://inv.example.com).
 * Falls back to a relative path if origin is empty.
 */
export function buildGs1UnitUrl(origin: string, gtin: string, unitSerial: string): string {
  const path = `/01/${encodeURIComponent(gtin)}/21/${encodeURIComponent(unitSerial)}`;
  const base = (origin ?? '').trim().replace(/\/+$/, '');
  return base ? `${base}${path}` : path;
}

export function buildInternalEntityUrl(
  origin: string,
  kind: 'location' | 'package' | 'order' | 'stock' | 'generic',
  payload: string,
): string {
  const prefix = { location: 'l', package: 'p', order: 'o', stock: 's', generic: 'q' }[kind];
  const path = `/${prefix}/${encodeURIComponent(payload)}`;
  const base = (origin ?? '').trim().replace(/\/+$/, '');
  return base ? `${base}${path}` : path;
}

// ─── MULTI-AI DATA MATRIX PARSER ──────────────────────────────────────────────
//
// Real Data Matrix codes from carrier shipping labels, pharma, and consumer
// electronics packaging encode multiple GS1 Application Identifiers in one
// payload. Two transmission forms in the wild:
//
//   1. FNC1-prefixed, GS-separated:
//        <FNC1>0101234567890128<GS>21SERIAL123<GS>17251231<GS>10LOT1
//      `<FNC1>` is typically transmitted as ASCII 0x1D ("]C1" symbology
//      identifier prefix may also appear and is stripped by ZXing).
//
//   2. Human-readable, parenthesized:
//        (01)01234567890128(21)SERIAL123(17)251231(10)LOT1
//
// Fixed-length AIs (01, 11, 13, 15, 17, 20, ...) terminate by length.
// Variable-length AIs (10, 21, 240, 400, 420, ...) terminate at the next FS
// (0x1D) or at end-of-string.

/** GS1 Application Identifier dictionary (only the ones we route on). */
const GS1_AI_FIXED_LEN: Record<string, number> = {
  '00': 18, // SSCC
  '01': 14, // GTIN
  '02': 14, // GTIN of contained trade items
  '11': 6,  // production date YYMMDD
  '13': 6,  // packaging date
  '15': 6,  // best-before
  '17': 6,  // expiration date
  '20': 2,  // variant
};

/** Variable-length AIs we recognize (max length). Any AI not listed is parsed greedily up to FS or end. */
const GS1_AI_VAR_MAX: Record<string, number> = {
  '10': 20,  // batch / lot
  '21': 20,  // serial
  '22': 20,  // additional product id
  '30': 8,   // count
  '37': 8,   // count of trade items in a logistic unit
  '240': 30, // additional product identification
  '400': 30, // customer's PO number
  '420': 20, // ship-to postal code
  '421': 12, // ship-to postal code w/ ISO country
};

const FNC1 = ''; // ASCII GS

export type Gs1AiTree = {
  /** Original raw payload (with FNC1 / parentheses removed for analysis). */
  raw: string;
  ais: Record<string, string>;
};

/** Strip ZXing symbology identifiers like `]C1`, `]d2`, `]Q1` that may prefix scans. */
function stripSymbologyId(raw: string): string {
  return raw.replace(/^\][A-Za-z][0-9]/, '');
}

/**
 * Parse a GS1 AI payload from either FNC1-separated or parenthesized form.
 * Returns null when the input is clearly not an AI-encoded payload.
 */
export function parseGs1AiPayload(raw: string): Gs1AiTree | null {
  if (!raw) return null;
  const cleaned = stripSymbologyId(raw.trim());
  if (!cleaned) return null;

  // Parenthesized form: (01)...(21)...
  if (cleaned.includes('(') && /\((\d{2,4})\)/.test(cleaned)) {
    const ais: Record<string, string> = {};
    const re = /\((\d{2,4})\)([^(]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
      const ai = m[1];
      const value = m[2].trim();
      if (value) ais[ai] = value;
    }
    return Object.keys(ais).length > 0 ? { raw: cleaned, ais } : null;
  }

  // FNC1 / fixed-length form. Must start with a recognized 2-4 digit AI.
  // Tolerate a leading FNC1.
  const stripped = cleaned.replace(/^/, '');
  if (!/^\d{2}/.test(stripped)) return null;

  const ais: Record<string, string> = {};
  let i = 0;
  let parsedAny = false;
  while (i < stripped.length) {
    // Choose AI length: 4-digit AIs exist (240, 250, 310x, 400, 420…). Try 4, then 3, then 2.
    let ai = '';
    let aiLen = 0;
    for (const tryLen of [4, 3, 2]) {
      const candidate = stripped.slice(i, i + tryLen);
      if (/^\d+$/.test(candidate) && (GS1_AI_FIXED_LEN[candidate] !== undefined || GS1_AI_VAR_MAX[candidate] !== undefined)) {
        ai = candidate;
        aiLen = tryLen;
        break;
      }
    }
    if (!ai) break;

    i += aiLen;
    const fixedLen = GS1_AI_FIXED_LEN[ai];
    let value: string;
    if (fixedLen !== undefined) {
      value = stripped.slice(i, i + fixedLen);
      i += fixedLen;
    } else {
      const maxLen = GS1_AI_VAR_MAX[ai] ?? 30;
      const fs = stripped.indexOf(FNC1, i);
      const end = fs === -1 ? Math.min(stripped.length, i + maxLen) : Math.min(fs, i + maxLen);
      value = stripped.slice(i, end);
      i = end;
      if (stripped[i] === FNC1) i += 1;
    }

    if (value) {
      ais[ai] = value;
      parsedAny = true;
    }
  }

  return parsedAny ? { raw: stripped, ais } : null;
}

/** Convenience: collapse a parsed AI tree to the highest-priority single value for routing. */
export function pickAiRoutingValue(tree: Gs1AiTree): { kind: 'serial' | 'tracking' | 'lot' | 'gtin' | 'expiry'; value: string } | null {
  // Priority: serial (21) > tracking (00/420) > lot (10) > GTIN (01) > expiry (17).
  if (tree.ais['21']) return { kind: 'serial', value: tree.ais['21'] };
  if (tree.ais['00']) return { kind: 'tracking', value: tree.ais['00'] };
  if (tree.ais['420']) return { kind: 'tracking', value: tree.ais['420'] };
  if (tree.ais['10']) return { kind: 'lot', value: tree.ais['10'] };
  if (tree.ais['01']) return { kind: 'gtin', value: tree.ais['01'] };
  if (tree.ais['17']) return { kind: 'expiry', value: tree.ais['17'] };
  return null;
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
