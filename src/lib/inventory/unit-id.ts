/**
 * unit-id.ts
 * ────────────────────────────────────────────────────────────────────
 * Generator for the per-unit identifier printed under the DataMatrix
 * on every product box label.
 *
 * Format:  {SKU_SHORT}-{YYWW}-{SEQ6}
 * Example: 00098-2621-000142   (week 21 of 2026, the 142nd unit)
 *
 * SKU_SHORT — uppercase the SKU text, drop non-alphanumeric except dashes,
 *             trim to 20 characters max. So "iPhone 13/128 Blue" becomes
 *             "IPHONE13128BLUE".
 * YYWW      — 2-digit ISO year + 2-digit ISO week (1-53). Electronics
 *             industry convention: Apple, Intel, Dell, and most contract
 *             manufacturers stamp YYWW on box labels and serial plates so
 *             an operator can eyeball when a unit was packed without a
 *             database lookup. ISO 8601 weeks start Monday; week 1 is the
 *             week containing the year's first Thursday.
 * SEQ6      — zero-padded sequence number, allocated atomically per
 *             (sku_catalog_id, calendar_year) via the Phase 0
 *             fn_next_unit_seq SQL function. The seq partition is by
 *             calendar year (not ISO year) so the DB-side allocator stays
 *             unchanged — the YYWW in the printed string is human-readable
 *             metadata and never used to partition rows.
 *
 * The DataMatrix encoding is independent of this string. When a GTIN is
 * available the bwip-js render uses GS1 AIs `(01)<gtin>(21)<serial>` —
 * the YYWW serial in the printed text is just the (21) value's
 * human-readable form.
 *
 * Legacy units (`{base_sku}:A01`-style from before 2026-05-18) keep their
 * old IDs in the DB; the scan resolver supports both formats.
 */

import { queryOne } from '@/lib/neon-client';

/**
 * Strip a SKU down to the printable short form used in the unit ID.
 * No DB call.
 */
export function shortSku(sku: string): string {
  return String(sku ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '') // keep dashes for readability
    .slice(0, 20)
    .replace(/^-+|-+$/g, ''); // trim leading/trailing dashes
}

/**
 * ISO 8601 week-year + week number for a UTC date. The Thursday in the
 * given week determines the ISO year — so Dec 29 2025 (Monday) is in ISO
 * week 1 of 2026, and Jan 1 2023 (Sunday) is in ISO week 52 of 2022.
 */
export function isoWeekParts(date: Date): { isoYear: number; isoWeek: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Shift to the Thursday in the same ISO week. (getUTCDay returns 0=Sun,
  // 1=Mon, ..., 6=Sat; map 0 → 7 so Monday-based math works.)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const dayMs = 86400000;
  const isoWeek = Math.ceil(((d.getTime() - yearStart.getTime()) / dayMs + 1) / 7);
  return { isoYear: d.getUTCFullYear(), isoWeek };
}

/**
 * Inverse of {@link formatUnitId} — split a `{SKU_SHORT}-{YYWW}-{SEQ6}` unit
 * id back into its parts. The last two dash-segments are always a 4-digit
 * YYWW and a 6-digit zero-padded sequence, so the base SKU (which may itself
 * contain dashes, e.g. `IPH13-128-BLU`) is everything before them.
 *
 * Returns null for legacy (`{base}:A01`) or otherwise non-conforming ids so
 * callers can fall back. No DB call.
 */
export function parseUnitId(
  unitId: string,
): { baseSku: string; yyww: string; seq: number } | null {
  const m = /^(.+)-(\d{4})-(\d{6})$/.exec(String(unitId ?? '').trim());
  if (!m) return null;
  return { baseSku: m[1], yyww: m[2], seq: Number(m[3]) };
}

export function formatUnitId(
  skuShort: string,
  isoYear: number,
  isoWeek: number,
  seq: number,
): string {
  if (!skuShort) throw new Error('formatUnitId: skuShort is empty after normalization');
  if (!Number.isInteger(isoYear) || isoYear < 2000 || isoYear > 2999) {
    throw new Error(`formatUnitId: invalid isoYear ${isoYear}`);
  }
  if (!Number.isInteger(isoWeek) || isoWeek < 1 || isoWeek > 53) {
    throw new Error(`formatUnitId: invalid isoWeek ${isoWeek}`);
  }
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error(`formatUnitId: invalid seq ${seq}`);
  }
  const yy = String(isoYear % 100).padStart(2, '0');
  const ww = String(isoWeek).padStart(2, '0');
  return `${skuShort}-${yy}${ww}-${String(seq).padStart(6, '0')}`;
}

/**
 * Allocate the next unit sequence for (sku_catalog_id, calendar_year) via
 * the fn_next_unit_seq SQL function (Phase 0 migration). Atomic —
 * concurrent callers get consecutive distinct numbers.
 *
 * yearOverride only affects the DB partition key (and the returned `year`
 * field). YYWW in the rendered unitId is always computed from the
 * allocation moment, so tests passing yearOverride still get a
 * coherent-looking week stamp from "now".
 */
export async function allocateNextUnitId(
  skuCatalogId: number,
  skuText: string,
  yearOverride?: number,
): Promise<{
  unitId: string;
  seq: number;
  year: number;
  isoYear: number;
  isoWeek: number;
  skuShort: string;
}> {
  const now = new Date();
  const year = yearOverride ?? now.getUTCFullYear();
  const { isoYear, isoWeek } = isoWeekParts(now);
  const skuShort = shortSku(skuText);
  if (!skuShort) {
    throw new Error(`allocateNextUnitId: SKU "${skuText}" produced empty short form`);
  }

  const row = await queryOne<{ seq: number }>`
    SELECT fn_next_unit_seq(${skuCatalogId}, ${year}) AS seq
  `;
  const seq = Number(row?.seq);
  if (!Number.isFinite(seq) || seq < 1) {
    throw new Error(`allocateNextUnitId: fn_next_unit_seq returned ${row?.seq}`);
  }

  return {
    unitId: formatUnitId(skuShort, isoYear, isoWeek, seq),
    seq,
    year,
    isoYear,
    isoWeek,
    skuShort,
  };
}
