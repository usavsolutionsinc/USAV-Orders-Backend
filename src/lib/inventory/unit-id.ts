/**
 * unit-id.ts
 * ────────────────────────────────────────────────────────────────────
 * Generator for the new per-unit identifier format introduced 2026-05-18
 * with the QR-label migration.
 *
 * Format:  {SKU_SHORT}-{YEAR}-{SEQ6}
 * Example: IPH13-128-BLU-2026-000142
 *
 * SKU_SHORT — uppercase the SKU text, drop non-alphanumeric except dashes,
 *             trim to 20 characters max. So "iPhone 13/128 Blue" becomes
 *             "IPHONE13128BLUE".
 * YEAR      — 4-digit year of intake.
 * SEQ6      — zero-padded sequence number, allocated atomically per
 *             (sku_catalog_id, year) via the Phase 0 fn_next_unit_seq
 *             SQL function.
 *
 * This replaces the legacy `{base_sku}:A01`-style format used by the
 * pre-migration `/api/sku-manager` endpoint. Legacy units in the DB
 * keep their old IDs (the scan resolver supports both formats).
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

export function formatUnitId(skuShort: string, year: number, seq: number): string {
  if (!skuShort) throw new Error('formatUnitId: skuShort is empty after normalization');
  if (!Number.isInteger(year) || year < 2000 || year > 2999) {
    throw new Error(`formatUnitId: invalid year ${year}`);
  }
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error(`formatUnitId: invalid seq ${seq}`);
  }
  return `${skuShort}-${year}-${String(seq).padStart(6, '0')}`;
}

/**
 * Allocate the next unit sequence for (sku_catalog_id, year) via the
 * fn_next_unit_seq SQL function (Phase 0 migration). Atomic — concurrent
 * callers get consecutive distinct numbers.
 */
export async function allocateNextUnitId(
  skuCatalogId: number,
  skuText: string,
  yearOverride?: number,
): Promise<{ unitId: string; seq: number; year: number; skuShort: string }> {
  const year = yearOverride ?? new Date().getUTCFullYear();
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
    unitId: formatUnitId(skuShort, year, seq),
    seq,
    year,
    skuShort,
  };
}
