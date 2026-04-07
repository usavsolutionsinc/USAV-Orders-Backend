import { db } from '@/lib/drizzle/db';
import { itemLocationStock, items, zohoLocations } from '@/lib/drizzle/schema';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { syncSkuCatalogFromItems } from '@/lib/neon/sku-catalog-queries';

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginatedResult<T> {
  rows: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface InsertItem {
  zohoItemId: string;
  zohoItemGroupId?: string | null;
  name: string;
  sku?: string | null;
  upc?: string | null;
  ean?: string | null;
  description?: string | null;
  itemType?: string | null;
  productType?: string | null;
  status: string;
  rate?: string | null;
  purchaseRate?: string | null;
  unit?: string | null;
  reorderLevel?: number | null;
  initialStock?: string | null;
  taxId?: string | null;
  taxName?: string | null;
  taxPercentage?: string | null;
  imageUrl?: string | null;
  quantityAvailable?: string | null;
  quantityOnHand?: string | null;
  customFields?: Record<string, unknown>;
  internalNotes?: string | null;
  zohoLastModified?: Date | null;
  syncedAt?: Date;
}

export interface UpsertLocationInput {
  zohoLocationId: string;
  name: string;
  isPrimary?: boolean;
  address?: Record<string, unknown>;
}

export interface UpsertItemLocationStockInput {
  itemId: string;
  locationId: string;
  quantityAvailable?: string | null;
  quantityOnHand?: string | null;
  syncedAt?: Date;
}

export interface ItemRepository {
  findById(id: string): Promise<typeof items.$inferSelect | null>;
  findByZohoId(zohoId: string): Promise<typeof items.$inferSelect | null>;
  findBySku(sku: string): Promise<typeof items.$inferSelect | null>;
  upsertMany(rows: InsertItem[]): Promise<void>;
  listActive(pagination: PaginationParams): Promise<PaginatedResult<typeof items.$inferSelect>>;
  upsertLocations(rows: UpsertLocationInput[]): Promise<void>;
  findLocationsByZohoIds(zohoIds: string[]): Promise<Array<typeof zohoLocations.$inferSelect>>;
  upsertItemLocationStock(rows: UpsertItemLocationStockInput[]): Promise<void>;
}

export class DrizzleItemRepository implements ItemRepository {
  async findById(id: string) {
    const rows = await db.select().from(items).where(eq(items.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findByZohoId(zohoId: string) {
    const rows = await db.select().from(items).where(eq(items.zohoItemId, zohoId)).limit(1);
    return rows[0] ?? null;
  }

  async findBySku(sku: string) {
    const rows = await db.select().from(items).where(eq(items.sku, sku)).limit(1);
    return rows[0] ?? null;
  }

  async upsertMany(rows: InsertItem[]): Promise<void> {
    if (rows.length === 0) return;
    await db.insert(items).values(rows).onConflictDoUpdate({
      target: items.zohoItemId,
      set: {
        zohoItemGroupId: sql`excluded.zoho_item_group_id`,
        name: sql`excluded.name`,
        sku: sql`excluded.sku`,
        upc: sql`excluded.upc`,
        ean: sql`excluded.ean`,
        description: sql`excluded.description`,
        itemType: sql`excluded.item_type`,
        productType: sql`excluded.product_type`,
        status: sql`excluded.status`,
        rate: sql`excluded.rate`,
        purchaseRate: sql`excluded.purchase_rate`,
        unit: sql`excluded.unit`,
        reorderLevel: sql`excluded.reorder_level`,
        initialStock: sql`excluded.initial_stock`,
        taxId: sql`excluded.tax_id`,
        taxName: sql`excluded.tax_name`,
        taxPercentage: sql`excluded.tax_percentage`,
        imageUrl: sql`excluded.image_url`,
        quantityAvailable: sql`excluded.quantity_available`,
        quantityOnHand: sql`excluded.quantity_on_hand`,
        customFields: sql`excluded.custom_fields`,
        internalNotes: sql`excluded.internal_notes`,
        zohoLastModified: sql`excluded.zoho_last_modified`,
        syncedAt: sql`excluded.synced_at`,
        updatedAt: sql`now()`,
      },
    });

    // Sync upserted items into sku_catalog hub
    try {
      await syncSkuCatalogFromItems(
        rows.map((r) => ({
          sku: r.sku,
          name: r.name,
          upc: r.upc,
          ean: r.ean,
          image_url: r.imageUrl,
          status: r.status,
        })),
      );
    } catch (err) {
      console.error('[itemRepository] sku_catalog sync failed (non-blocking):', err);
    }
  }

  async listActive(pagination: PaginationParams) {
    const limit = Math.max(1, Math.min(200, pagination.limit ?? 50));
    const offset = Math.max(0, pagination.offset ?? 0);
    const [rows, totalResult] = await Promise.all([
      db.select().from(items).where(eq(items.status, 'active')).orderBy(asc(items.name)).limit(limit).offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(items).where(eq(items.status, 'active')),
    ]);
    return {
      rows,
      total: totalResult[0]?.count ?? 0,
      limit,
      offset,
    };
  }

  async upsertLocations(rows: UpsertLocationInput[]): Promise<void> {
    if (rows.length === 0) return;
    await db.insert(zohoLocations).values(rows.map((row) => ({
      zohoLocationId: row.zohoLocationId,
      name: row.name,
      isPrimary: row.isPrimary ?? false,
      address: row.address ?? {},
      syncedAt: new Date(),
    }))).onConflictDoUpdate({
      target: zohoLocations.zohoLocationId,
      set: {
        name: sql`excluded.name`,
        isPrimary: sql`excluded.is_primary`,
        address: sql`excluded.address`,
        syncedAt: sql`excluded.synced_at`,
      },
    });
  }

  async findLocationsByZohoIds(zohoIds: string[]) {
    if (zohoIds.length === 0) return [];
    return db.select().from(zohoLocations).where(inArray(zohoLocations.zohoLocationId, zohoIds));
  }

  async upsertItemLocationStock(rows: UpsertItemLocationStockInput[]): Promise<void> {
    if (rows.length === 0) return;
    await db.insert(itemLocationStock).values(rows.map((row) => ({
      itemId: row.itemId,
      locationId: row.locationId,
      quantityAvailable: row.quantityAvailable ?? '0',
      quantityOnHand: row.quantityOnHand ?? '0',
      syncedAt: row.syncedAt ?? new Date(),
    }))).onConflictDoUpdate({
      target: [itemLocationStock.itemId, itemLocationStock.locationId],
      set: {
        quantityAvailable: sql`excluded.quantity_available`,
        quantityOnHand: sql`excluded.quantity_on_hand`,
        syncedAt: sql`excluded.synced_at`,
      },
    });
  }
}

export const itemRepository = new DrizzleItemRepository();
