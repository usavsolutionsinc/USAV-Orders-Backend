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

/**
 * Collapse a tracking value that is the *same* number repeated back-to-back.
 * A double-scan or double-paste (e.g. "9400…3451" pasted twice) produces a
 * 2x/3x-length string that fails carrier detection and never registers. When
 * the cleaned string is an exact N-fold repetition of a single unit (N = 2,3)
 * and that unit is long enough to be a real tracking number, return one copy.
 *
 * Only collapses *identical* repeats — two different concatenated numbers are
 * left untouched. The 12-char minimum unit makes a coincidental match between
 * a real tracking number and a perfect repetition effectively impossible.
 */
export function collapseRepeatedTracking(input: string): string {
  const clean = normalizeTrackingCanonical(input);
  const len = clean.length;
  if (len < 24) return clean; // shortest doubled tracking is 2 × 12 chars
  for (const n of [2, 3]) {
    if (len % n !== 0) continue;
    const unit = len / n;
    if (unit < 12) continue;
    const first = clean.slice(0, unit);
    let allMatch = true;
    for (let i = 1; i < n; i++) {
      if (clean.slice(i * unit, (i + 1) * unit) !== first) { allMatch = false; break; }
    }
    if (allMatch) return first;
  }
  return clean;
}

/**
 * FedEx GS1-128 / "96" concatenated-barcode envelope.
 *
 * Anchored on the structurally-unambiguous FedEx application-identifier form:
 * a "96"-prefixed 33-34 digit label (covers the 9621/9622/9627… AIs). This is
 * the same long-label shape `TRACKING_PATTERNS` recognizes as FedEx
 * (`^96\d{31,32}$` in carrier-patterns.ts) — kept in lock-step here so the two
 * never drift. USPS IMpb numbers use the 92/93/94/95 service-banner prefix (and
 * 420… routing), NEVER 96, and are at most 22 digits — so anchoring on this
 * 96-prefixed 33-34 digit envelope can collide with a USPS number on neither
 * prefix nor length.
 */
const FEDEX_GS1_CONCAT_RE = /^96\d{31,32}$/;

/**
 * Strip the FedEx GS1-128 / "96" concatenated-barcode envelope down to the
 * human-readable carrier tracking number.
 *
 * Barcode guns read the FULL application-identifier label (e.g.
 * `9632001960200651497200382141152045`, 33-34 digits), while the number a
 * buyer/vendor types or pastes into Zoho's reference# is the SHORT human form
 * (`382141152045`). FedEx embeds that human number in the trailing digits of
 * the long label, so both must canonicalize to the SAME key — otherwise a
 * scanned carton and its pasted PO reference never reconcile except by the
 * fragile last-8 suffix.
 *
 * HARDENED (2026-06-23): fires ONLY on a `FEDEX_GS1_CONCAT_RE` envelope, never
 * on a bare trailing-pattern guess. The earlier `^\d{18,34}$` gate folded the
 * trailing 12-digit run of valid 22-digit USPS IMpb numbers
 * (e.g. `9235990407314810260579` → `314810260579`) onto FedEx Express tails —
 * which would have merged ~500 distinct USPS shipments onto one key. Anchoring
 * on the 96-prefixed 33-34 digit form drops those USPS rewrites to zero. See
 * docs/new-additions/tracking-canonicalization-stn-plan.md §3.1.
 *
 * Conservative by construction: only acts on a 96-prefixed GS1 concat label,
 * and only collapses to a trailing slice that independently detects as a FedEx
 * number (longest-first, so a 15-digit Ground number is never truncated to its
 * trailing 12). Anything else is returned untouched — so this can only make a
 * value MORE canonical, never corrupt a number that was already human-readable.
 */
export function stripFedexConcatPrefix(input: string): string {
  const clean = normalizeTrackingCanonical(input);
  // Only a 96-prefixed GS1 concat label is an envelope to unwrap. Everything
  // else — every USPS 92/93/94/95 number, every already-human FedEx number, any
  // shorter/longer string — is returned untouched.
  if (!FEDEX_GS1_CONCAT_RE.test(clean)) return clean;
  // FedEx human tracking lengths, longest-first. Accept the longest trailing
  // slice that (a) is shorter than the full label and (b) detects as FedEx.
  for (const n of [15, 12]) {
    if (clean.length <= n) continue;
    const tail = clean.slice(-n);
    if (detectCarrier(tail) === 'FedEx') return tail;
  }
  return clean;
}

/** Normalize tracking number, collapsing exact repeats and stripping USPS routing prefix. */
export const normalizeTrackingNumber = (input: string): string =>
  stripUspsRoutingPrefix(collapseRepeatedTracking(normalizeTrackingCanonical(input)));

/**
 * Canonical match/display key for a tracking number — the single normalizer the
 * receiving scan + paste boundaries should run every value through so a scanned
 * GS1 barcode and a pasted human number land on one identical value.
 *
 * Pipeline: canonical → collapse doubled scans → strip USPS IMpb routing prefix
 * → strip FedEx GS1/"96" concat envelope. Each step is a no-op when it doesn't
 * apply, so a value that is already human-readable passes through unchanged.
 */
export function extractCanonicalTracking(input: string): string {
  return stripFedexConcatPrefix(normalizeTrackingNumber(input));
}

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
// Delegates to the canonical pattern list in utils/carrier-patterns.ts.
// This keeps one set of patterns shared with scan-resolver.ts.

import { detectCarrierFromTracking, toDisplayCarrier } from '@/utils/carrier-patterns';

/**
 * Detect carrier from a tracking number string.
 * Returns a display-friendly carrier name (UPS, FedEx, USPS, DHL, Amazon, Unknown).
 */
export function detectCarrier(tracking: string): Carrier {
  const code = detectCarrierFromTracking(tracking);
  if (!code) return 'Unknown';
  const display = toDisplayCarrier(code);
  // Map display names back to the Carrier union for backward compatibility
  switch (display) {
    case 'UPS':       return 'UPS';
    case 'FedEx':     return 'FedEx';
    case 'USPS':      return 'USPS';
    case 'DHL':       return 'DHL';
    case 'Amazon':    return 'AMAZON';
    default:          return display as Carrier;
  }
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
