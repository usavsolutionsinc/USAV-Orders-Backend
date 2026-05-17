/**
 * serialUnits repository
 * ────────────────────────────────────────────────────────────────────
 * Typed reads on the serial_units master registry. Writes are deliberately
 * minimal in Phase 0: upsertSerialUnit() is the single canonical
 * find-or-create helper, mirroring the behavior used by mark-received and
 * the legacy backfill scripts. Phase 3+ will introduce state-transition
 * helpers that also emit inventory_events in the same transaction.
 *
 * Pattern note: callers that already hold a transactional client should
 * pass it via `client`; otherwise the default `db` is used. This is the
 * same convention as src/lib/repositories/itemRepository.ts.
 */
import { db } from '@/lib/drizzle/db';
import { serialUnits } from '@/lib/drizzle/schema';
import type { SerialUnit } from '@/lib/drizzle/schema';
import { eq, sql } from 'drizzle-orm';

/** Canonical serial normalization: trim + uppercase. */
export function normalizeSerial(serial: string): string {
  return String(serial ?? '').trim().toUpperCase();
}

export interface UpsertSerialUnitInput {
  /** Raw serial as scanned. Stored verbatim in serial_number. */
  serialNumber: string;
  /** SKU code if known at upsert time. Nullable. */
  sku?: string | null;
  /** sku_catalog.id if resolved. Nullable. */
  skuCatalogId?: number | null;
  zohoItemId?: string | null;
  /** Where this serial first entered the system. Free-form code (e.g. 'receiving','tech','legacy'). */
  originSource?: string | null;
  originReceivingLineId?: number | null;
  originTsnId?: number | null;
  /**
   * Initial status to set IF this is a NEW row. Existing rows are NEVER
   * downgraded by upsert — lifecycle transitions belong to state helpers.
   */
  initialStatus?: SerialUnit['currentStatus'];
  notes?: string | null;
}

/**
 * Find-or-create by normalized_serial. Existing rows are filled-in (sku,
 * skuCatalogId, originReceivingLineId) only when the corresponding column
 * is currently NULL — never clobbered.
 */
export async function upsertSerialUnit(input: UpsertSerialUnitInput): Promise<SerialUnit> {
  const normalized = normalizeSerial(input.serialNumber);
  if (!normalized) {
    throw new Error('upsertSerialUnit: serialNumber is empty after normalization');
  }

  const result = await db
    .insert(serialUnits)
    .values({
      serialNumber: input.serialNumber,
      normalizedSerial: normalized,
      sku: input.sku ?? null,
      skuCatalogId: input.skuCatalogId ?? null,
      zohoItemId: input.zohoItemId ?? null,
      currentStatus: input.initialStatus ?? 'UNKNOWN',
      originSource: input.originSource ?? null,
      originReceivingLineId: input.originReceivingLineId ?? null,
      originTsnId: input.originTsnId ?? null,
      notes: input.notes ?? null,
    })
    .onConflictDoUpdate({
      target: serialUnits.normalizedSerial,
      set: {
        // Fill-in only — preserve existing values when set.
        sku: sql`COALESCE(${serialUnits.sku}, EXCLUDED.sku)`,
        skuCatalogId: sql`COALESCE(${serialUnits.skuCatalogId}, EXCLUDED.sku_catalog_id)`,
        zohoItemId: sql`COALESCE(${serialUnits.zohoItemId}, EXCLUDED.zoho_item_id)`,
        originReceivingLineId: sql`COALESCE(${serialUnits.originReceivingLineId}, EXCLUDED.origin_receiving_line_id)`,
        originTsnId: sql`COALESCE(${serialUnits.originTsnId}, EXCLUDED.origin_tsn_id)`,
        updatedAt: sql`NOW()`,
      },
    })
    .returning();

  return result[0];
}

export async function findSerialUnitByNormalized(normalized: string): Promise<SerialUnit | null> {
  const rows = await db
    .select()
    .from(serialUnits)
    .where(eq(serialUnits.normalizedSerial, normalized))
    .limit(1);
  return rows[0] ?? null;
}

export async function findSerialUnitBySerial(serial: string): Promise<SerialUnit | null> {
  return findSerialUnitByNormalized(normalizeSerial(serial));
}

export async function getSerialUnitById(id: number): Promise<SerialUnit | null> {
  const rows = await db.select().from(serialUnits).where(eq(serialUnits.id, id)).limit(1);
  return rows[0] ?? null;
}
