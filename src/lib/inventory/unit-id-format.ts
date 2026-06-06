/**
 * unit-id-format.ts
 * ────────────────────────────────────────────────────────────────────
 * Pure (no-DB, no-`pg`) helpers for the per-unit identifier printed under
 * the DataMatrix on every product box label. Split out of `unit-id.ts` so
 * client components (e.g. the mobile Prepacked Products sheet) can parse /
 * format a unit id WITHOUT pulling the server-only `neon-client` (`pg`) into
 * the browser bundle. `unit-id.ts` re-exports all of these.
 *
 * Format:  {SKU_SHORT}-{YYWW}-{SEQ6}
 * Example: 00098-2621-000142   (week 21 of 2026, the 142nd unit)
 *
 * SKU_SHORT — uppercase the SKU text, drop non-alphanumeric except dashes,
 *             trim to 20 characters max ("iPhone 13/128 Blue" → "IPHONE13128BLUE").
 * YYWW      — 2-digit ISO year + 2-digit ISO week (1-53), the electronics
 *             box-label convention. ISO 8601 weeks start Monday; week 1 is the
 *             week containing the year's first Thursday.
 * SEQ6      — zero-padded sequence number, allocated atomically per
 *             (sku_catalog_id, calendar_year) — see allocateNextUnitId in
 *             unit-id.ts.
 *
 * Legacy units (`{base_sku}:A01`-style from before 2026-05-18) keep their
 * old IDs; parseUnitId returns null for those so callers can fall back.
 */

/**
 * Strip a SKU down to the printable short form used in the unit ID.
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
 * Returns null for legacy (`{base}:A01`) or otherwise non-conforming ids.
 */
export function parseUnitId(
  unitId: string,
): { baseSku: string; yyww: string; seq: number } | null {
  const m = /^(.+)-(\d{4})-(\d{6})$/.exec(String(unitId ?? '').trim());
  if (!m) return null;
  return { baseSku: m[1], yyww: m[2], seq: Number(m[3]) };
}

/**
 * Human-readable breakdown of a printed unit id, for UI display (e.g. the
 * mobile Prepacked Products sheet). Reuses {@link parseUnitId} — the `YYWW`
 * segment is split into a 2-digit ISO year + ISO week and `seq` is the unit's
 * running number. `display` is the compact one-line chip form.
 *
 * Returns null for legacy (`{base}:A01`) or otherwise non-conforming ids.
 */
export function describeUnitId(
  unitId: string,
):
  | { baseSku: string; week: number; year: number; seq: number; display: string }
  | null {
  const p = parseUnitId(unitId);
  if (!p) return null;
  const yy = Number(p.yyww.slice(0, 2));
  const ww = Number(p.yyww.slice(2, 4));
  const year = 2000 + yy;
  return {
    baseSku: p.baseSku,
    week: ww,
    year,
    seq: p.seq,
    display: `WK${String(ww).padStart(2, '0')} '${String(yy).padStart(2, '0')} · #${String(p.seq).padStart(6, '0')}`,
  };
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
