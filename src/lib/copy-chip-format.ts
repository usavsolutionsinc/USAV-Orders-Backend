/**
 * Pure string helpers for the id-chip family (`@/components/ui/CopyChip`).
 *
 * Split out of the `'use client'` component module (same pattern as
 * `inventory/unit-id-format.ts`) so server code and tests can use them
 * without pulling in React/client-only imports. `CopyChip.tsx` re-exports
 * these, so existing importers keep working.
 */
import { isEmptyDisplayValue } from '@/utils/empty-display-value';

export function normalizeCopyText(value: string | null | undefined): string {
  if (isEmptyDisplayValue(value)) return '';
  return String(value || '').trim();
}

export function getLast4(value: string | null | undefined): string {
  const raw = normalizeCopyText(value);
  return raw.length > 4 ? raw.slice(-4) : raw || '---';
}

/**
 * serial_number may be a CSV string aggregated via STRING_AGG (e.g. "SN1, SN2").
 * Parses it, takes the last individual serial, then returns its last 4 chars.
 */
export function getLast4Serial(value: string | null | undefined): string {
  const raw = normalizeCopyText(value);
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const last = parts.length > 0 ? parts[parts.length - 1] : '';
  return last.length > 4 ? last.slice(-4) : last || '---';
}

/**
 * Pack/tech "tracking" fields sometimes hold a static SKU code (`PROD:qty`, `:tag`) rather than a carrier number.
 * Those must use the SKU chip, not TrackingChip.
 */
export function isSkuFormattedScanRef(value: string | null | undefined): boolean {
  const raw = normalizeCopyText(value);
  return raw.includes(':');
}

/** True when a chip label is one of the "no value" spellings (`''`/null/`'---'`). */
export function isEmptyChipDisplay(value: string | null | undefined): boolean {
  return isEmptyDisplayValue(value) || String(value || '').trim() === '---';
}

/**
 * The shared empty-state fallback for id-chip labels: collapses every "no
 * value" spelling to the 4-char `'----'` placeholder so empty columns line up
 * with filled rows; otherwise returns the label unchanged.
 */
export function resolveChipDisplay(display: string | null | undefined): string {
  return isEmptyChipDisplay(display) ? '----' : String(display);
}

/**
 * The single source of truth for a serial chip's label. Derives the last-4
 * preview from the raw serial (or CSV of serials), and collapses every "no
 * serial" spelling callers used to pass — `''`/`null`, the literal sentinel
 * `'SERIAL'`, or `'---'` — to one `'----'` placeholder that matches the empty
 * state of the other id chips (OrderIdChip/TrackingChip), so an empty serial
 * column reads like a 4-char value and lines up with filled rows instead of
 * showing the wider `SERIAL` word. (Blindly running {@link getLast4Serial} on
 * the `'SERIAL'` sentinel used to yield `'RIAL'`, which is why every table
 * previously hand-rolled its own variant.)
 */
export function resolveSerialDisplay(value: string | null | undefined): string {
  const raw = (value || '').trim();
  if (isEmptyDisplayValue(raw) || raw === '---' || raw.toUpperCase() === 'SERIAL') {
    return '----';
  }
  return getLast4Serial(raw);
}
