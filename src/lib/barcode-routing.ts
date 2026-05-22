/**
 * Barcode routing helpers — used by the mobile scan flow and by anywhere
 * the app needs to classify an inbound scan or paste.
 *
 * Recognized inputs:
 *   - URL handles (printed by the receiving sidebar) — always start with
 *     "http(s)://…/m/r/{id}", "…/m/l/{id}", or "…/m/u/{id|serial}".
 *     The path is also recognized when the value is a bare path
 *     (e.g. "/m/r/42") so legacy or wedge-captured scans still resolve.
 *   - Legacy carton string "RCV-123".
 *   - Static SKU:   starts with a digit AND contains ":" (e.g. "12345:HP-PSU").
 *   - Bin barcode:  starts with a letter (e.g. "A12", "B04").
 *   - Anything else falls back to SKU lookup (safer default).
 */

export type ScanType =
  | 'sku'
  | 'bin'
  | 'receiving'        // R-class — carton handle
  | 'receiving-line'   // L-class — single line within a carton
  | 'serial-unit';     // U-class — one physical unit

export interface ScanRoute {
  type: ScanType;
  value: string;
  /** When set, callers should navigate here (relative path within the app). */
  redirect?: string;
}

const MOBILE_PATH_RE = /\/m\/(r|l|u)\/([^/?#\s]+)/i;
const SKU_STOCK_LOCATION_RE = /\/sku-stock\/location\/([^/?#\s]+)/i;
// GS1 Digital Link — capture gtin and optional serial after /21/.
// Exported so the GS1 resolver (src/lib/gs1/parser.ts) can reuse the
// same fast-path regex without re-declaring it.
export const GS1_PATH_RE = /\/01\/(\d{8,14})(?:\/21\/([^/?#\s]+))?/i;
// GS1 Digital Link for a warehouse location: /414/{gln}/254/{code}
// where {code} is the flat location string (e.g. "A0101101"). Emitted by
// the Location Label Printer via gs1LocationUrl(); printed bin labels
// scan back to this path.
export const GS1_LOCATION_RE = /\/414\/(\d+)\/254\/([^/?#\s]+)/i;

function pathToRoute(path: string, value: string): ScanRoute | null {
  const m = MOBILE_PATH_RE.exec(path);
  if (m) {
    const [, classKey, idRaw] = m;
    const id = decodeURIComponent(idRaw);
    switch (classKey.toLowerCase()) {
      case 'r':
        return { type: 'receiving',      value, redirect: `/m/r/${id}` };
      case 'l':
        return { type: 'receiving-line', value, redirect: `/m/l/${id}` };
      case 'u':
        return { type: 'serial-unit',    value, redirect: `/m/u/${id}` };
      default:
        return null;
    }
  }
  const binMatch = SKU_STOCK_LOCATION_RE.exec(path);
  if (binMatch) {
    const barcode = decodeURIComponent(binMatch[1]);
    return { type: 'bin', value, redirect: `/inventory?bin=${barcode}` };
  }
  // GS1 location label printed by the Location Label Printer. The QR
  // encodes the flat code in the 254 segment (locationCodeFlat()), which
  // is what we persist as `locations.barcode` in registerPrintedLocations.
  // Returning the code as `value` lets server-side lookups hit the row
  // directly without re-parsing the URL.
  const gs1Loc = GS1_LOCATION_RE.exec(path);
  if (gs1Loc) {
    const code = decodeURIComponent(gs1Loc[2]).toUpperCase();
    return { type: 'bin', value: code, redirect: `/inventory?bin=${code}` };
  }
  // GS1 Digital Link form. Page-side resolvers translate gtin → sku and
  // serial → unit at runtime, so we just dispatch to the catch-all paths.
  const gs1 = GS1_PATH_RE.exec(path);
  if (gs1) {
    const [, gtin, serial] = gs1;
    if (serial) {
      return { type: 'serial-unit', value, redirect: `/01/${gtin}/21/${decodeURIComponent(serial)}` };
    }
    return { type: 'sku', value, redirect: `/01/${gtin}` };
  }
  return null;
}

/**
 * Classify a scanned / typed value. Returns null for empty input.
 */
export function routeScan(raw: string): ScanRoute | null {
  const value = raw.trim();
  if (!value) return null;

  // 1. URL form (printed QR payloads) — accept absolute http(s) and bare paths.
  if (/^https?:\/\//i.test(value)) {
    try {
      const u = new URL(value);
      const matched = pathToRoute(u.pathname, value);
      if (matched) return matched;
    } catch {
      /* fall through */
    }
  }
  if (value.startsWith('/')) {
    const matched = pathToRoute(value, value);
    if (matched) return matched;
  }

  // 2. Legacy RCV-{id} carton string.
  const rcv = /^RCV-(\d+)$/i.exec(value);
  if (rcv) {
    return { type: 'receiving', value, redirect: `/m/r/${rcv[1]}` };
  }

  // 3. Static SKU: digit prefix + contains ":".
  if (/^\d/.test(value) && value.includes(':')) return { type: 'sku', value };

  // 4. Bin: starts with a letter.
  if (/^[A-Za-z]/.test(value)) return { type: 'bin', value };

  // 5. Default fallback → SKU.
  return { type: 'sku', value };
}

/** Back-compat shim for callers that only need the type. */
export function detectScanType(raw: string): ScanType {
  return routeScan(raw)?.type ?? 'sku';
}

// ─── Print-side helpers ─────────────────────────────────────────────────────

/**
 * Base URL embedded in every printed QR. Hard-coded to the production deploy
 * so labels printed from a localhost dev session still open the right page
 * when scanned with a phone (a localhost URL on a printed sticker is useless).
 * Override via NEXT_PUBLIC_APP_URL for staging or alt-domain printing.
 */
export const QR_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://usav-orders-backend.vercel.app';

/**
 * Public domain encoded in the *unit-level* GS1 Digital Link QR (the QR on a
 * serialized product label). A normal phone-camera scan opens
 * `https://usavshop.com/01/{gtin}/21/{unitSerial}`, which the storefront is
 * responsible for resolving / redirecting. The in-app scanner ignores host
 * and parses the GS1 path locally (see {@link parseScannedUrl}), so this URL
 * works for both flows. Override with NEXT_PUBLIC_LABEL_QR_BASE_URL.
 */
export const PUBLIC_UNIT_QR_BASE_URL = (
  process.env.NEXT_PUBLIC_LABEL_QR_BASE_URL ?? 'https://usavshop.com'
).replace(/\/$/, '');

/**
 * Build the absolute URL embedded in a printed QR. Always anchors to
 * {@link QR_BASE_URL} so printed labels work regardless of which environment
 * they were printed from.
 *
 * Bin labels (kind='b') route into the Inventory page's bin view (`?bin=`)
 * so the bin editor lives next to the rest of the inventory tooling.
 * Other kinds stay on their dedicated /m/* pages for the receiving / unit flows.
 */
export function mobileQrUrl(
  kind: 'r' | 'l' | 'u' | 'b' | 'k',
  id: string | number,
): string {
  const encoded = encodeURIComponent(String(id));
  const path =
    kind === 'b'
      ? `/inventory?bin=${encoded}`
      : `/m/${kind}/${encoded}`;
  try {
    return new URL(path, QR_BASE_URL).toString();
  } catch {
    return `${QR_BASE_URL.replace(/\/$/, '')}${path}`;
  }
}

/**
 * GS1 Digital Link URL. Encodes a GTIN, optionally with a serial number.
 *   /01/{gtin}                  — product class
 *   /01/{gtin}/21/{serial}      — unique item
 *
 * Anchored to the QR_BASE_URL so the same domain that hosts our own QR
 * payloads also hosts the GS1 form — phones scanning either land here and
 * our resolver redirects to the right page.
 */
export function gs1DigitalLinkUrl(opts: {
  gtin: string;
  serial?: string | null;
  batch?: string | null;
}): string {
  const gtin = encodeURIComponent(String(opts.gtin || '').trim());
  if (!gtin) return QR_BASE_URL;
  let path = `/01/${gtin}`;
  if (opts.serial && opts.serial.trim()) {
    path += `/21/${encodeURIComponent(opts.serial.trim())}`;
  }
  if (opts.batch && opts.batch.trim()) {
    path += `/10/${encodeURIComponent(opts.batch.trim())}`;
  }
  try {
    return new URL(path, QR_BASE_URL).toString();
  } catch {
    return `${QR_BASE_URL.replace(/\/$/, '')}${path}`;
  }
}

// ─── Warehouse-location helpers (Zone / Aisle / Bay / Level / Position) ────

/**
 * Placeholder GLN used by GS1 in their documentation and sandbox examples.
 * Swap to your real GLN once registered with GS1 US.
 */
export const DEFAULT_GLN = '0614141000005';

/** Pad a numeric segment to 2 digits — 01, 02, 03 … */
export function pad2(n: number | string): string {
  const num = typeof n === 'string' ? parseInt(n, 10) : n;
  if (!Number.isFinite(num)) return String(n).padStart(2, '0');
  return String(Math.max(0, Math.floor(num))).padStart(2, '0');
}

/** No padding — used for the Level tier (1, 2, …, 10). */
export function noPad(n: number | string): string {
  const num = typeof n === 'string' ? parseInt(n, 10) : n;
  if (!Number.isFinite(num)) return String(n);
  return String(Math.max(0, Math.floor(num)));
}

export interface LocationSegments {
  /** Single uppercase letter A–Z. Tied to a named room (e.g. "Cage 4" → "C"). */
  zone: string;
  aisle: number | string;
  bay: number | string;
  level: number | string;
  position: number | string;
}

/** Normalize zone input to a single uppercase letter; fallback to 'X' if invalid. */
function zoneLetter(z: string | number | undefined | null): string {
  const c = String(z ?? '').trim().toUpperCase().charAt(0);
  return /[A-Z]/.test(c) ? c : 'X';
}

/**
 * Compact dash-separated location code — A-01-01-1-01.
 *   zone letter · 2-digit aisle · 2-digit bay · unpadded level · 2-digit position.
 */
export function locationCode(s: LocationSegments): string {
  return `${zoneLetter(s.zone)}-${pad2(s.aisle)}-${pad2(s.bay)}-${noPad(s.level)}-${pad2(s.position)}`;
}

/** Tight all-caps code (no dashes) used inside the GS1 URI. */
export function locationCodeFlat(s: LocationSegments): string {
  return `${zoneLetter(s.zone)}${pad2(s.aisle)}${pad2(s.bay)}${noPad(s.level)}${pad2(s.position)}`;
}

/**
 * Bays alternate sides of the aisle: odd → Left, even → Right.
 * Used as a guide label on printed stickers so staff know which way to face.
 */
export function bayHand(bay: number | string): 'Left' | 'Right' {
  const n = typeof bay === 'string' ? parseInt(bay, 10) : bay;
  return Number.isFinite(n) && n % 2 === 0 ? 'Right' : 'Left';
}

/**
 * GS1 Digital Link URI for a warehouse location.
 *   /414/{gln}/254/{code}
 *
 * AI 414 = Identification of a physical location (GLN).
 * AI 254 = GLN extension component (our Z/A/B/L/P breakdown).
 */
export function gs1LocationUrl(
  s: LocationSegments,
  opts?: { gln?: string; baseUrl?: string },
): string {
  const gln = (opts?.gln || DEFAULT_GLN).trim();
  const baseUrl = (opts?.baseUrl || QR_BASE_URL).replace(/\/$/, '');
  const code = locationCodeFlat(s);
  const path = `/414/${encodeURIComponent(gln)}/254/${encodeURIComponent(code)}`;
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return `${baseUrl}${path}`;
  }
}
