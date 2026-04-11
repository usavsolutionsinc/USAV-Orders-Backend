/**
 * Barcode routing helpers for the mobile SKU Stock scan flow.
 *
 * Convention (per USAV bin/catalog naming):
 *   - Static SKU:  starts with a digit AND contains a colon ":"
 *                  e.g. "12345:HP-240W-PSU", "987:BOSE-SB700"
 *   - Bin barcode: starts with a letter
 *                  e.g. "A12", "B04", "BIN-01"
 *
 * Anything else falls back to SKU lookup (safer default: SkuDetailView will
 * render a "not found" state rather than silently routing to the wrong view).
 */

export type ScanType = 'sku' | 'bin';

export interface ScanRoute {
  type: ScanType;
  value: string;
}

/**
 * Classify a scanned / typed barcode into one of our two routing buckets.
 */
export function detectScanType(raw: string): ScanType {
  const code = raw.trim();
  if (!code) return 'sku';

  // Static SKU: digit prefix + contains ":"
  if (/^\d/.test(code) && code.includes(':')) return 'sku';

  // Bin: starts with a letter
  if (/^[A-Za-z]/.test(code)) return 'bin';

  // Default fallback → SKU
  return 'sku';
}

/**
 * Normalize and classify in one step. Returns null for empty input.
 */
export function routeScan(raw: string): ScanRoute | null {
  const value = raw.trim();
  if (!value) return null;
  return { type: detectScanType(value), value };
}
