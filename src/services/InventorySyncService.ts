import { zohoClient } from '@/lib/zoho/ZohoInventoryClient';
import type { ZohoItem, ZohoWarehouse } from '@/lib/zoho/types';
import { itemRepository } from '@/lib/repositories/itemRepository';
import { syncCursorRepository } from '@/lib/repositories/syncCursorRepository';
import { formatApiOffsetTimestamp } from '@/utils/date';

export interface SyncResult {
  count: number;
}

function toDecimal(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? String(num) : null;
}

function toInteger(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? Math.floor(num) : null;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function mapZohoItemToLocal(item: ZohoItem) {
  return {
    zohoItemId: item.item_id,
    zohoItemGroupId: item.item_group_id ?? null,
    name: String(item.name || item.item_id),
    sku: item.sku ?? null,
    upc: item.upc ?? null,
    ean: item.ean ?? null,
    description: item.description ?? null,
    itemType: item.item_type ?? null,
    productType: item.product_type ?? null,
    status: String(item.status || 'active').toLowerCase(),
    rate: toDecimal(item.rate),
    purchaseRate: toDecimal(item.purchase_rate),
    unit: item.unit ?? null,
    reorderLevel: toInteger(item.reorder_level),
    initialStock: toDecimal(item.initial_stock),
    taxId: item.tax_id ?? null,
    taxName: item.tax_name ?? null,
    taxPercentage: toDecimal(item.tax_percentage),
    imageUrl: item.image_url ?? null,
    quantityAvailable: toDecimal(item.available_stock),
    quantityOnHand: toDecimal(item.stock_on_hand),
    customFields: Array.isArray(item.custom_fields) ? { values: item.custom_fields } : {},
    zohoLastModified: toDate(item.last_modified_time),
    syncedAt: new Date(),
  };
}

function extractLocationStock(item: ZohoItem) {
  const rawLocations: Array<Record<string, unknown>> = Array.isArray(item.locations)
    ? item.locations as Array<Record<string, unknown>>
    : Array.isArray(item.warehouses)
      ? item.warehouses as Array<Record<string, unknown>>
      : [];
  return rawLocations
    .map((entry) => ({
      zohoLocationId: String(entry.location_id || entry.warehouse_id || '').trim(),
      name: String(entry.location_name || entry.warehouse_name || '').trim(),
      quantityAvailable: toDecimal(entry.available_stock ?? entry.warehouse_available_stock),
      quantityOnHand: toDecimal(entry.stock_on_hand ?? entry.warehouse_stock_on_hand ?? entry.initial_stock),
    }))
    .filter((entry) => entry.zohoLocationId && entry.name);
}

export class InventorySyncService {
  async fullSync(): Promise<SyncResult> {
    const startTime = Date.now();
    let count = 0;

    for await (const page of zohoClient.paginateItems({ filter_by: 'Status.All' })) {
      await this.upsertItems(page);
      count += page.length;
    }

    await this.syncLocations();
    await syncCursorRepository.upsert('items', { lastSyncedAt: new Date(), fullSyncAt: new Date() });
    console.info({ event: 'items.full_sync.complete', count, duration_ms: Date.now() - startTime });
    return { count };
  }

  async incrementalSync(): Promise<SyncResult> {
    const cursor = await syncCursorRepository.get('items');
    const since = cursor?.lastSyncedAt ?? new Date(0);
    let count = 0;

    for await (const page of zohoClient.paginateItems({
      last_modified_time: formatApiOffsetTimestamp(since),
      per_page: 200,
    })) {
      await this.upsertItems(page);
      count += page.length;
    }

    await this.syncLocations();
    await syncCursorRepository.upsert('items', { lastSyncedAt: new Date() });
    return { count };
  }

  async updateZohoBackedItem(itemId: string, payload: Record<string, unknown>) {
    const updated = await zohoClient.updateItem(itemId, payload);
    await itemRepository.upsertMany([mapZohoItemToLocal(updated)]);
    return updated;
  }

  private async upsertItems(rows: ZohoItem[]): Promise<void> {
    if (rows.length === 0) return;
    await itemRepository.upsertMany(rows.map(mapZohoItemToLocal));

    const locationInputs = rows.flatMap(extractLocationStock);
    await itemRepository.upsertLocations(locationInputs.map((row) => ({
      zohoLocationId: row.zohoLocationId,
      name: row.name,
    })));

    const existingItems = await Promise.all(rows.map((row) => itemRepository.findByZohoId(row.item_id)));
    const locations = await itemRepository.findLocationsByZohoIds(
      Array.from(new Set(locationInputs.map((row) => row.zohoLocationId)))
    );
    const itemIdByZohoId = new Map(
      existingItems.filter(Boolean).map((row) => [row!.zohoItemId, row!.id])
    );
    const locationIdByZohoId = new Map(locations.map((row) => [row.zohoLocationId, row.id]));

    await itemRepository.upsertItemLocationStock(
      rows.flatMap((item) =>
        extractLocationStock(item)
          .map((stock) => {
            const itemId = itemIdByZohoId.get(item.item_id);
            const locationId = locationIdByZohoId.get(stock.zohoLocationId);
            if (!itemId || !locationId) return null;
            return {
              itemId,
              locationId,
              quantityAvailable: stock.quantityAvailable,
              quantityOnHand: stock.quantityOnHand,
              syncedAt: new Date(),
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      )
    );
  }

  private async syncLocations() {
    const pages: ZohoWarehouse[] = [];
    for await (const page of zohoClient.paginateWarehouses()) {
      pages.push(...page);
    }
    await itemRepository.upsertLocations(pages.map((warehouse) => ({
      zohoLocationId: warehouse.warehouse_id,
      name: warehouse.warehouse_name,
      isPrimary: !!warehouse.is_primary,
      address: typeof warehouse.address === 'object' && warehouse.address ? warehouse.address as Record<string, unknown> : {},
    })));
  }
}
