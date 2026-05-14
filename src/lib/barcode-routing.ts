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

function pathToRoute(path: string, value: string): ScanRoute | null {
  const m = MOBILE_PATH_RE.exec(path);
  if (!m) return null;
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
 * Build the absolute URL embedded in a printed QR. Always anchors to
 * {@link QR_BASE_URL} so printed labels work regardless of which environment
 * they were printed from.
 */
export function mobileQrUrl(
  kind: 'r' | 'l' | 'u' | 'b' | 'k',
  id: string | number,
): string {
  const path = `/m/${kind}/${encodeURIComponent(String(id))}`;
  try {
    return new URL(path, QR_BASE_URL).toString();
  } catch {
    return `${QR_BASE_URL.replace(/\/$/, '')}${path}`;
  }
}
