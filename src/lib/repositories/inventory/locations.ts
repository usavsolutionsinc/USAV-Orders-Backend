/**
 * locations repository
 * ────────────────────────────────────────────────────────────────────
 * Typed reads against the bin-addressable locations table and its
 * bin_contents projection. Distinct from the legacy zoho_locations
 * mirror (which lives in itemRepository.ts).
 *
 * Important: bin_contents rows are now MAINTAINED via the sku_stock_ledger
 * + trigger flow (since 2026-04-15). Callers that need to mutate quantity
 * should write to skuStockLedger (see ./stockLedger.ts), not to this
 * module's hypothetical mutators.
 */
import { db } from '@/lib/drizzle/db';
import { binContents, locations } from '@/lib/drizzle/schema';
import type { BinContent, Location } from '@/lib/drizzle/schema';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

export async function findLocationByBarcode(barcode: string): Promise<Location | null> {
  const rows = await db.select().from(locations).where(eq(locations.barcode, barcode)).limit(1);
  return rows[0] ?? null;
}

export async function findLocationByName(name: string): Promise<Location | null> {
  const rows = await db.select().from(locations).where(eq(locations.name, name)).limit(1);
  return rows[0] ?? null;
}

export async function getLocationById(id: number): Promise<Location | null> {
  const rows = await db.select().from(locations).where(eq(locations.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface ListBinsOptions {
  room?: string;
  activeOnly?: boolean;
  binType?: string;
  limit?: number;
}

export async function listBins(opts: ListBinsOptions = {}): Promise<Location[]> {
  const filters = [];
  if (opts.activeOnly !== false) filters.push(eq(locations.isActive, true));
  if (opts.room) filters.push(eq(locations.room, opts.room));
  if (opts.binType) filters.push(eq(locations.binType, opts.binType));
  // Bin rows have row_label + col_label; room headers have neither.
  filters.push(sql`${locations.rowLabel} IS NOT NULL AND ${locations.colLabel} IS NOT NULL`);

  const limit = opts.limit ?? 1000;
  return db
    .select()
    .from(locations)
    .where(and(...filters))
    .orderBy(asc(locations.sortOrder), asc(locations.name))
    .limit(limit);
}

export async function listBinContentsByLocation(locationId: number): Promise<BinContent[]> {
  return db
    .select()
    .from(binContents)
    .where(eq(binContents.locationId, locationId))
    .orderBy(asc(binContents.sku));
}

export async function listBinContentsBySku(sku: string): Promise<BinContent[]> {
  return db
    .select()
    .from(binContents)
    .where(eq(binContents.sku, sku))
    .orderBy(desc(binContents.qty));
}

/**
 * Sum bin_contents.qty for a SKU across all bins. Useful for spot-checking
 * against sku_stock_ledger sums in v_sku_stock_drift.
 */
export async function totalBinQtyForSku(sku: string): Promise<number> {
  const result = await db.execute<{ qty: number }>(sql`
    SELECT COALESCE(SUM(qty), 0)::int AS qty FROM bin_contents WHERE sku = ${sku}
  `);
  const rows = ((result as unknown as { rows?: { qty: number }[] }).rows) ?? (result as unknown as { qty: number }[]);
  return rows?.[0]?.qty ?? 0;
}
