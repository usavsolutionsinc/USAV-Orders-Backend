/**
 * carrier-patterns.ts
 * ─────────────────────────────────────────────────────────────────
 * Single source of truth for carrier detection patterns.
 *
 * Both `tracking-format.ts` (server-side) and `scan-resolver.ts`
 * (station controller) import from here so patterns stay in sync.
 *
 * Patterns are ordered from most-specific to broadest to prevent
 * false positives. All matching is done against normalised input
 * (upper-cased, non-alphanumeric chars stripped).
 * ─────────────────────────────────────────────────────────────────
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type CarrierCode =
  | 'UPS'
  | 'UPS_MI'
  | 'FEDEX'
  | 'USPS'
  | 'DHL_EXPRESS'
  | 'DHL_ECOMMERCE'
  | 'AMAZON'
  | 'UPU_INTL'
  | 'ONTRAC'
  | 'LASERSHIP'
  | 'GSO';

/**
 * Simplified carrier name for display / DB storage.
 * Maps the granular CarrierCode to a user-facing label.
 */
export type DisplayCarrier = 'UPS' | 'FedEx' | 'USPS' | 'DHL' | 'Amazon' | 'OnTrac' | 'LaserShip' | 'GSO' | 'Unknown';

export function toDisplayCarrier(code: CarrierCode | null): DisplayCarrier {
  if (!code) return 'Unknown';
  switch (code) {
    case 'UPS':
    case 'UPS_MI':
      return 'UPS';
    case 'FEDEX':
      return 'FedEx';
    case 'USPS':
      return 'USPS';
    case 'DHL_EXPRESS':
    case 'DHL_ECOMMERCE':
      return 'DHL';
    case 'AMAZON':
      return 'Amazon';
    case 'UPU_INTL':
      return 'USPS'; // International postal items route through USPS domestically
    case 'ONTRAC':
      return 'OnTrac';
    case 'LASERSHIP':
      return 'LaserShip';
    case 'GSO':
      return 'GSO';
    default:
      return 'Unknown';
  }
}

// ─── Normalisation (duplicated intentionally to avoid circular dep) ─────────

function normalize(input: string): string {
  return String(input || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Strip USPS IMpb routing prefix (420 + ZIP/ZIP+4) from barcode scans.
 *
 * Formats:
 *   420XXXXX + 20-22 digit tracking  (28-30 chars — 5-digit ZIP)
 *   420XXXXXXXXX + 20-22 digit tracking (32-34 chars — ZIP+4)
 */
function stripUspsRouting(clean: string): string {
  if (!clean.startsWith('420') || clean.length < 28) return clean;

  // 5-digit ZIP prefix (420XXXXX = 8 chars)
  if (clean.length >= 28 && clean.length <= 30) {
    const after5 = clean.slice(8);
    if (/^9\d{19,21}$/.test(after5)) return after5;
  }

  // 9-digit ZIP+4 prefix (420XXXXXXXXX = 12 chars)
  if (clean.length >= 32 && clean.length <= 34) {
    const after9 = clean.slice(12);
    if (/^9\d{19,21}$/.test(after9)) return after9;
  }

  return clean;
}

// ─── Canonical Pattern List ─────────────────────────────────────────────────
//
//  Every carrier regex is tested against a normalised, USPS-routing-stripped
//  input string. Order matters — more-specific patterns first.

export const TRACKING_PATTERNS: ReadonlyArray<{ carrier: CarrierCode; regex: RegExp }> = [
  // UPS — 1Z + 16 alphanumeric chars (18 total)
  { carrier: 'UPS',           regex: /^1Z[A-Z0-9]{16}$/ },

  // UPS Mail Innovations / SurePost — 22-34 digits, often starts with 9274 or MI prefix
  { carrier: 'UPS_MI',        regex: /^MI\d{20,30}$/ },
  { carrier: 'UPS_MI',        regex: /^9274\d{22,28}$/ },

  // FedEx Express — 12 digits, commonly prefixed with 3 or 9
  { carrier: 'FEDEX',         regex: /^[39]\d{11}$/ },

  // FedEx Ground — 15 digits, frequently prefixed with 96 or 7
  { carrier: 'FEDEX',         regex: /^(96\d{13}|7\d{14})$/ },

  // FedEx Ground Economy (legacy SmartPost) — 20 digits, often prefixed with 92 or 61
  { carrier: 'FEDEX',         regex: /^(92|61)\d{18}$/ },

  // FedEx Freight — typically 15-25 digits, usually prefixed with 96
  { carrier: 'FEDEX',         regex: /^96\d{13,23}$/ },

  // FedEx Custom Critical — variable length, often prefixed with 00 or 01
  { carrier: 'FEDEX',         regex: /^(00|01)\d{10,28}$/ },

  // FedEx long labels (33-34 digits, 96XX prefix) — covers 9621, 9622, 9627, etc.
  { carrier: 'FEDEX',         regex: /^96\d{31,32}$/ },

  // FedEx Ground 2D / SSC34 — 34 digits, prefixed with 9261
  { carrier: 'FEDEX',         regex: /^9261\d{30}$/ },

  // USPS — IMpb with routing prefix: 420 + 5-digit ZIP (+ optional 4-digit ZIP ext) + 20-22 digit tracking
  { carrier: 'USPS',          regex: /^420\d{5}(\d{4})?(9[2345]\d{18,20}|9\d{15,21}|\d{20,22})$/ },
  // USPS — IMpb starts 9XXXX (various lengths 16-22) or pure-digit 20-22
  { carrier: 'USPS',          regex: /^(9[2345][0-9]{18,20}|9[0-9]{15,21}|[0-9]{20,22})$/ },

  // DHL eCommerce — JD + 18, GM + 14-18, LX + 13, JVGL + 14
  { carrier: 'DHL_ECOMMERCE', regex: /^JD\d{18}$/ },
  { carrier: 'DHL_ECOMMERCE', regex: /^GM\d{14,18}$/ },
  { carrier: 'DHL_ECOMMERCE', regex: /^LX\d{13}$/ },
  { carrier: 'DHL_ECOMMERCE', regex: /^JVGL\d{14}$/ },

  // DHL Express — 10 or 11 pure digits (must come after USPS to avoid false match on longer strings)
  { carrier: 'DHL_EXPRESS',   regex: /^\d{10,11}$/ },

  // Amazon Logistics — TBA + 12-15 alphanumeric chars
  { carrier: 'AMAZON',        regex: /^TBA[A-Z0-9]{12,15}$/ },

  // UPU international postal — 2 letters + 9 digits + 2 letters (e.g. LZ123456789US)
  { carrier: 'UPU_INTL',      regex: /^[A-Z]{2}\d{9}[A-Z]{2}$/ },

  // OnTrac — C + 14 digits (15 total)
  { carrier: 'ONTRAC',        regex: /^C\d{14}$/ },

  // LaserShip — 1LS + 12 digits (15 total)
  { carrier: 'LASERSHIP',     regex: /^1LS\d{12}$/ },

  // GSO — 2 letters + 14 digits (16 total)
  { carrier: 'GSO',           regex: /^[A-Z]{2}\d{14}$/ },
];

// ─── Detection Function ─────────────────────────────────────────────────────

/**
 * Detect carrier from a raw tracking input.
 * Normalises and strips USPS routing prefix before matching.
 * Returns the granular CarrierCode, or null if no pattern matches.
 */
export function detectCarrierFromTracking(raw: string): CarrierCode | null {
  const norm = normalize(raw);
  if (!norm) return null;

  // Strip USPS 420+ZIP routing prefix so barcode scans match correctly
  const t = stripUspsRouting(norm);

  for (const { carrier, regex } of TRACKING_PATTERNS) {
    if (regex.test(t)) return carrier;
  }

  return null;
}
