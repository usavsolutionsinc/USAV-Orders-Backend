/**
 * tracking-format.ts
 * ─────────────────────────────────────────────────────────────────
 * Single source of truth for tracking number normalization and
 * carrier detection. All tracking-related utilities live here.
 * ─────────────────────────────────────────────────────────────────
 */

// ─── Carrier type ────────────────────────────────────────────────────────────

export type Carrier = 'UPS' | 'USPS' | 'FedEx' | 'FEDEX' | 'DHL' | 'AMAZON' | 'Unknown';

// ─── Normalization ───────────────────────────────────────────────────────────

export function normalizeTrackingCanonical(input: string): string {
  return String(input || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Null-safe alias of normalizeTrackingCanonical — used as a dedup/map key. */
export function normalizeTrackingKey(value: string | null | undefined): string {
  return normalizeTrackingCanonical(String(value || ''));
}

/**
 * Strip the USPS IMpb routing prefix (420 + ZIP/ZIP+4) from barcode scans.
 * Barcode scanners read the full IMpb which prepends 420+ZIP (5 or 9 digits)
 * to the actual tracking number. The DB stores only the tracking portion.
 *
 * Formats:
 *   420XXXXX + 20-22 digit tracking  (28-30 chars total — 5-digit ZIP)
 *   420XXXXXXXXX + 20-22 digit tracking (32-34 chars total — ZIP+4)
 */
export function stripUspsRoutingPrefix(input: string): string {
  const clean = normalizeTrackingCanonical(input);
  if (!clean.startsWith('420') || clean.length < 28) return clean;

  // Try 5-digit ZIP prefix (420XXXXX = 8 chars)
  if (clean.length >= 28 && clean.length <= 30) {
    const after5 = clean.slice(8);
    if (/^9\d{19,21}$/.test(after5)) return after5;
  }

  // Try 9-digit ZIP+4 prefix (420XXXXXXXXX = 12 chars)
  if (clean.length >= 32 && clean.length <= 34) {
    const after9 = clean.slice(12);
    if (/^9\d{19,21}$/.test(after9)) return after9;
  }

  return clean;
}

/** Normalize tracking number, stripping USPS routing prefix if present. */
export const normalizeTrackingNumber = (input: string): string =>
  stripUspsRoutingPrefix(normalizeTrackingCanonical(input));

/** Alias for FBA FNSKU normalization — identical to normalizeTrackingCanonical. */
export const normalizeFnsku = normalizeTrackingCanonical;

export function normalizeTrackingKey18(input: string): string {
  const normalized = normalizeTrackingCanonical(input);
  if (!normalized) return '';
  return normalized.length > 18 ? normalized.slice(-18) : normalized;
}

export const key18FromStoredTracking = normalizeTrackingKey18;

export function normalizeTrackingLast8(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length >= 8) {
    return digitsOnly.slice(-8);
  }

  return trimmed;
}

export function last8FromStoredTracking(input: string): string {
  const digitsOnly = String(input || '').replace(/\D/g, '');
  return digitsOnly.slice(-8);
}

/** Clean and normalize tracking number (remove non-alphanumeric, uppercase). */
export const cleanTrackingNumber = normalizeTrackingCanonical;

/** Last 8 characters for display. */
export function formatTrackingNumber(tracking: string): string {
  if (!tracking) return '';
  return tracking.length > 8 ? tracking.slice(-8) : tracking;
}

/** Last 8 characters, lowercased. */
export function getLastEightDigits(str: string): string {
  if (!str) return '';
  return String(str).trim().slice(-8).toLowerCase();
}

/** True if string contains at least one digit. */
export function hasNumbers(str: string): boolean {
  if (!str) return false;
  return /\d/.test(String(str));
}

// ─── Carrier detection ──────────────────────────────────────────────────────
//
// Single implementation used everywhere. Patterns ordered from most-specific
// to broadest to prevent false positives.

/**
 * Detect carrier from a normalized (uppercase, alphanumeric-only) tracking number.
 * Uses prefix-based heuristics covering UPS, FedEx, USPS, DHL, Amazon.
 */
export function detectCarrier(tracking: string): Carrier {
  const t = normalizeTrackingCanonical(tracking);
  if (!t) return 'Unknown';

  // UPS: 1Z + 16 alphanumeric
  if (/^1Z[A-Z0-9]{16}$/.test(t)) return 'UPS';

  // FedEx: 9621 long labels (33-34 digits)
  if (/^9621\d{29,30}$/.test(t)) return 'FedEx';
  // FedEx: 399 prefix (12 digits)
  if (/^399\d{9}$/.test(t)) return 'FedEx';
  // FedEx: 96+20, 1[4-9]+14, or pure 12/15/20 digits
  if (/^(96\d{20}|1[456789]\d{14}|\d{20}|\d{15}|\d{12})$/.test(t)) return 'FedEx';

  // USPS: IMpb starting 92/93/94/95 (20-22 digits) or generic 9+15-21
  if (/^(9[2345]\d{18,20}|9\d{15,21}|\d{20,22})$/.test(t)) return 'USPS';

  // DHL eCommerce: JD + 18 digits
  if (/^JD\d{18}$/.test(t)) return 'DHL';
  // DHL: JJD prefix
  if (/^JJD/.test(t)) return 'DHL';

  // Amazon Logistics: TBA + 12 digits
  if (/^TBA\d{12}$/.test(t)) return 'AMAZON';

  return 'Unknown';
}

/** Convenience alias matching the old utils/tracking.ts API name. */
export const getCarrier = detectCarrier;

// ─── Tracking URL builders ──────────────────────────────────────────────────

/**
 * Build a carrier tracking URL when the carrier is already known.
 * Falls back to Google search for unrecognized carriers.
 */
export function getTrackingUrlByCarrier(tracking: string, carrier: string): string {
  const c = String(carrier || '').toUpperCase().trim();
  if (c.includes('UPS'))    return `https://www.ups.com/track?tracknum=${tracking}`;
  if (c.includes('FEDEX'))  return `https://www.fedex.com/apps/fedextrack/?tracknumbers=${tracking}`;
  if (c.includes('USPS'))   return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tracking}`;
  if (c.includes('DHL'))    return `https://www.dhl.com/en/express/tracking.html?AWB=${tracking}`;
  if (c.includes('AMAZON')) return `https://www.amazon.com/progress-tracker/package/ref=pt_redirect_from_gp?trackingId=${tracking}`;
  return `https://www.google.com/search?q=${encodeURIComponent(tracking)}`;
}

/**
 * Build a carrier tracking URL by auto-detecting the carrier.
 * Returns null for empty/invalid tracking numbers.
 */
export function getTrackingUrl(tracking: string): string | null {
  if (!tracking || tracking === 'Not available' || tracking === 'N/A') return null;
  const carrier = detectCarrier(tracking);
  switch (carrier) {
    case 'UPS':    return `https://www.ups.com/track?track=yes&trackNums=${tracking}&loc=en_US&requester=ST/trackdetails`;
    case 'USPS':   return `https://tools.usps.com/go/TrackConfirmAction?qtc_tLabels1=${tracking}`;
    case 'FedEx':  return `https://www.fedex.com/fedextrack/?trknbr=${tracking}`;
    case 'DHL':    return `https://www.dhl.com/en/express/tracking.html?AWB=${tracking}`;
    case 'AMAZON': return `https://www.amazon.com/progress-tracker/package/ref=pt_redirect_from_gp?trackingId=${tracking}`;
    default:       return null;
  }
}
