/**
 * unit-id.ts
 * ────────────────────────────────────────────────────────────────────
 * Generator for the per-unit identifier printed under the DataMatrix
 * on every product box label.
 *
 * The PURE parse/format helpers (shortSku, isoWeekParts, parseUnitId,
 * describeUnitId, formatUnitId) live in `./unit-id-format` so they can be
 * imported by client components without dragging the server-only
 * `neon-client` (`pg`) into the browser bundle. They are re-exported here so
 * existing server-side import sites (`@/lib/inventory/unit-id`) keep working.
 *
 * Format:  {SKU_SHORT}-{YYWW}-{SEQ6}
 * Example: 00098-2621-000142   (week 21 of 2026, the 142nd unit)
 *
 * The seq partition is by calendar year (not ISO year) so the DB-side
 * allocator stays unchanged — the YYWW in the printed string is
 * human-readable metadata and never used to partition rows.
 *
 * The DataMatrix encoding is independent of this string. When a GTIN is
 * available the bwip-js render uses GS1 AIs `(01)<gtin>(21)<serial>` — the
 * YYWW serial in the printed text is just the (21) value's human-readable form.
 *
 * Legacy units (`{base_sku}:A01`-style from before 2026-05-18) keep their
 * old IDs in the DB; the scan resolver supports both formats.
 */

import { queryOne } from '@/lib/neon-client';
import {
  shortSku,
  isoWeekParts,
  parseUnitId,
  describeUnitId,
  formatUnitId,
} from '@/lib/inventory/unit-id-format';

export { shortSku, isoWeekParts, parseUnitId, describeUnitId, formatUnitId };

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
  const skuShortValue = shortSku(skuText);
  if (!skuShortValue) {
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
    unitId: formatUnitId(skuShortValue, isoYear, isoWeek, seq),
    seq,
    year,
    isoYear,
    isoWeek,
    skuShort: skuShortValue,
  };
}

/**
 * Non-committing preview of the next unit id for (sku_catalog_id, calendar
 * year) via fn_peek_unit_seq — does NOT advance the sequence. Used by the label
 * printer to show the operator what the next label will be before they commit
 * to printing (the authoritative allocation happens server-side at print time
 * via {@link allocateNextUnitId}). Returns the same shape as allocateNextUnitId.
 */
export async function peekNextUnitId(
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
  const skuShortValue = shortSku(skuText);
  if (!skuShortValue) {
    throw new Error(`peekNextUnitId: SKU "${skuText}" produced empty short form`);
  }

  const row = await queryOne<{ seq: number }>`
    SELECT fn_peek_unit_seq(${skuCatalogId}, ${year}) AS seq
  `;
  const seq = Number(row?.seq);
  if (!Number.isFinite(seq) || seq < 1) {
    throw new Error(`peekNextUnitId: fn_peek_unit_seq returned ${row?.seq}`);
  }

  return {
    unitId: formatUnitId(skuShortValue, isoYear, isoWeek, seq),
    seq,
    year,
    isoYear,
    isoWeek,
    skuShort: skuShortValue,
  };
}
