import { randomUUID } from 'crypto';

const ECWID_BASE_URL = 'https://app.ecwid.com/api/v3';
const SQUARE_PRODUCTION_BASE_URL = 'https://connect.squareup.com/v2';
const SQUARE_SANDBOX_BASE_URL = 'https://connect.squareupsandbox.com/v2';
const DEFAULT_ECWID_PAGE_LIMIT = 100;
const SQUARE_BATCH_OBJECT_LIMIT = 1000;

type Primitive = string | number | boolean | null | undefined;

interface EcwidProduct {
  id?: number | string;
  sku?: string | null;
  name?: string | null;
  description?: string | null;
  price?: number | string | null;
  enabled?: Primitive;
  product_is_available?: Primitive;
  [key: string]: unknown;
}

interface SquareMoney {
  amount: number;
  currency: string;
}

interface SquareItemVariationData {
  item_id?: string;
  name?: string;
  sku?: string;
  pricing_type?: string;
  price_money?: SquareMoney;
  [key: string]: unknown;
}

interface SquareItemData {
  name?: string;
  description?: string;
  variations?: SquareCatalogObject[];
  [key: string]: unknown;
}

interface SquareCatalogObject {
  id: string;
  type: 'ITEM' | 'ITEM_VARIATION';
  version?: number;
  item_data?: SquareItemData;
  item_variation_data?: SquareItemVariationData;
  [key: string]: unknown;
}

interface SquareCatalogListResponse {
  objects?: SquareCatalogObject[];
  cursor?: string;
}

interface SquareCatalogUpsertResponse {
  id_mappings?: Array<{ client_object_id?: string; object_id?: string }>;
  errors?: Array<{ code?: string; detail?: string; field?: string; category?: string }>;
}

interface SquareVariationLookup {
  variation: SquareCatalogObject;
  itemId: string | null;
}

interface SyncCounts {
  ecwidTotal: number;
  ecwidEnabled: number;
  skippedDisabled: number;
  skippedMissingSku: number;
  skippedInvalidPrice: number;
  squareObjectsCreate: number;
  squareObjectsUpdate: number;
  upsertedObjectCount: number;
}

export interface EcwidSquareSyncResult {
  success: boolean;
  dryRun: boolean;
  batchSizeUsed: number;
  counts: SyncCounts;
  currency: string;
  squareBaseUrl: string;
  skippedSkus: string[];
  warnings: string[];
  errors: string[];
  timestamp: string;
}

export async function syncEcwidToSquare(options?: { dryRun?: boolean; batchSize?: number }): Promise<EcwidSquareSyncResult> {
  const dryRun = Boolean(options?.dryRun);
  const batchSize = resolveBatchSize(options?.batchSize);
  const errors: string[] = [];
  const warnings: string[] = [];
  const skippedSkus: string[] = [];

  const ecwidStoreId = requiredEnvAny('ECWID_STORE_ID', [
    'ECWID_STOREID',
    'ECWID_STORE',
    'NEXT_PUBLIC_ECWID_STORE_ID',
  ]);
  const ecwidApiToken = requiredEnvAny('ECWID_API_TOKEN', [
    'ECWID_TOKEN',
    'ECWID_ACCESS_TOKEN',
    'NEXT_PUBLIC_ECWID_API_TOKEN',
  ]);
  const squareAccessToken = requiredEnvAny('SQUARE_ACCESS_TOKEN', [
    'SQUARE_TOKEN',
    'SQUARE_API_TOKEN',
    'NEXT_PUBLIC_SQUARE_ACCESS_TOKEN',
  ]);
  const squareVersion = process.env.SQUARE_VERSION || '2024-01-18';

  const squareBaseUrl = resolveSquareBaseUrl();
  const ecwidProducts = await fetchAllEcwidProducts(ecwidStoreId, ecwidApiToken);
  const enabledProducts = ecwidProducts.filter(isEcwidProductEnabled);

  const counts: SyncCounts = {
    ecwidTotal: ecwidProducts.length,
    ecwidEnabled: enabledProducts.length,
    skippedDisabled: ecwidProducts.length - enabledProducts.length,
    skippedMissingSku: 0,
    skippedInvalidPrice: 0,
    squareObjectsCreate: 0,
    squareObjectsUpdate: 0,
    upsertedObjectCount: 0,
  };

  const currency = await resolveEcwidStoreCurrency(ecwidStoreId, ecwidApiToken, warnings);
  const existingSquareCatalog = await listSquareCatalog(squareBaseUrl, squareAccessToken, squareVersion);
  const squareVariationsBySku = buildSquareVariationLookup(existingSquareCatalog.objects ?? []);
  const squareItemsById = buildSquareItemLookup(existingSquareCatalog.objects ?? []);

  const updateItemsById = new Map<string, SquareCatalogObject>();
  const objectsToUpsert: SquareCatalogObject[] = [];

  for (const product of enabledProducts) {
    const sku = String(product.sku || '').trim();
    if (!sku) {
      counts.skippedMissingSku += 1;
      skippedSkus.push('[missing-sku]');
      continue;
    }

    const amount = toMinorUnits(product.price);
    if (amount === null) {
      counts.skippedInvalidPrice += 1;
      skippedSkus.push(sku);
      warnings.push(`Skipping SKU ${sku}: invalid Ecwid price ${String(product.price ?? '')}`);
      continue;
    }

    const squareMatch = squareVariationsBySku.get(sku);
    const ecwidName = String(product.name || '').trim() || sku;
    if (!squareMatch) {
      const safeSku = sanitizeSkuForTempId(sku);
      const itemId = `#ITEM_${safeSku}`;
      const variationId = `#VAR_${safeSku}`;

      const createItem: SquareCatalogObject = {
        type: 'ITEM',
        id: itemId,
        item_data: {
          name: ecwidName,
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: variationId,
              item_variation_data: {
                item_id: itemId,
                name: 'Regular',
                sku,
                pricing_type: 'FIXED_PRICING',
                price_money: {
                  amount,
                  currency,
                },
              },
            },
          ],
        },
      };

      objectsToUpsert.push(createItem);
      counts.squareObjectsCreate += 1;
      continue;
    }

    const existingVariation = squareMatch.variation;
    const existingVariationData = existingVariation.item_variation_data || {};
    const updatedVariation: SquareCatalogObject = {
      type: 'ITEM_VARIATION',
      id: existingVariation.id,
      ...(typeof existingVariation.version === 'number' ? { version: existingVariation.version } : {}),
      item_variation_data: {
        ...existingVariationData,
        name: existingVariationData.name || 'Regular',
        sku,
        pricing_type: 'FIXED_PRICING',
        price_money: {
          amount,
          currency,
        },
      },
    };

    objectsToUpsert.push(updatedVariation);
    counts.squareObjectsUpdate += 1;

    if (squareMatch.itemId) {
      const existingItem = squareItemsById.get(squareMatch.itemId);
      if (existingItem?.item_data) {
        const currentName = String(existingItem.item_data.name || '').trim();

        if (currentName !== ecwidName) {
          updateItemsById.set(existingItem.id, {
            type: 'ITEM',
            id: existingItem.id,
            ...(typeof existingItem.version === 'number' ? { version: existingItem.version } : {}),
            item_data: {
              ...existingItem.item_data,
              name: ecwidName,
            },
          });
        }
      }
    }
  }

  Array.from(updateItemsById.values()).forEach((itemUpdate) => {
    objectsToUpsert.push(itemUpdate);
    counts.squareObjectsUpdate += 1;
  });

  counts.upsertedObjectCount = objectsToUpsert.length;

  if (dryRun || objectsToUpsert.length === 0) {
    return {
      success: true,
      dryRun,
      batchSizeUsed: batchSize,
      counts,
      currency,
      squareBaseUrl,
      skippedSkus,
      warnings,
      errors,
      timestamp: new Date().toISOString(),
    };
  }

  const batches = chunkArray(objectsToUpsert, batchSize);
  for (let index = 0; index < batches.length; index += 1) {
    const batchObjects = batches[index];

    const upsertResponse = await squareRequest<SquareCatalogUpsertResponse>(
      squareBaseUrl,
      '/catalog/batch-upsert',
      squareAccessToken,
      squareVersion,
      {
        method: 'POST',
        body: {
          idempotency_key: `ecwid-square-sync-${Date.now()}-${index + 1}-${randomUUID()}`,
          batches: [
            {
              objects: batchObjects,
            },
          ],
        },
      }
    );

    if (upsertResponse.errors?.length) {
      for (const err of upsertResponse.errors) {
        errors.push([err.code, err.detail, err.field].filter(Boolean).join(' | '));
      }
      break;
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      dryRun,
      batchSizeUsed: batchSize,
      counts,
      currency,
      squareBaseUrl,
      skippedSkus,
      warnings,
      errors,
      timestamp: new Date().toISOString(),
    };
  }

  return {
    success: true,
    dryRun,
    batchSizeUsed: batchSize,
    counts,
    currency,
    squareBaseUrl,
    skippedSkus,
    warnings,
    errors,
    timestamp: new Date().toISOString(),
  };
}

function requiredEnvAny(primaryName: string, aliases: string[] = []): string {
  const keysToCheck = [primaryName].concat(aliases);

  for (const key of keysToCheck) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  const normalizedPrimary = normalizeEnvKey(primaryName);
  const allEnvEntries = Object.entries(process.env);

  for (const entry of allEnvEntries) {
    const key = entry[0];
    const value = entry[1];
    if (normalizeEnvKey(key) === normalizedPrimary && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  const hints = allEnvEntries
    .map(([key]) => key)
    .filter((key) => key.toUpperCase().includes('ECWID') || key.toUpperCase().includes('SQUARE'))
    .slice(0, 8);

  const hintText = hints.length > 0 ? ` Found related vars: ${hints.join(', ')}` : '';
  throw new Error(
    `Missing required environment variable: ${primaryName}. Also checked aliases: ${keysToCheck.join(', ')}.${hintText}`
  );
}

function normalizeEnvKey(key: string): string {
  return key.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function resolveSquareBaseUrl(): string {
  const explicit = process.env.SQUARE_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const env = (process.env.SQUARE_ENVIRONMENT || '').trim().toUpperCase();
  if (env === 'SANDBOX') return SQUARE_SANDBOX_BASE_URL;

  return SQUARE_PRODUCTION_BASE_URL;
}

function resolveBatchSize(requestedSize: number | undefined): number {
  if (typeof requestedSize === 'number' && Number.isFinite(requestedSize)) {
    const normalized = Math.floor(requestedSize);
    if (normalized > 0) {
      return Math.min(normalized, SQUARE_BATCH_OBJECT_LIMIT);
    }
  }

  return SQUARE_BATCH_OBJECT_LIMIT;
}

async function fetchAllEcwidProducts(storeId: string, token: string): Promise<EcwidProduct[]> {
  const products: EcwidProduct[] = [];
  let offset = 0;

  while (true) {
    const url = new URL(`${ECWID_BASE_URL}/${storeId}/products`);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(DEFAULT_ECWID_PAGE_LIMIT));

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const body = await safeReadText(response);
      throw new Error(`Ecwid product list request failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as { items?: EcwidProduct[] };
    const pageItems = Array.isArray(data.items) ? data.items : [];
    products.push(...pageItems);

    if (pageItems.length < DEFAULT_ECWID_PAGE_LIMIT) {
      break;
    }

    offset += DEFAULT_ECWID_PAGE_LIMIT;
  }

  return products;
}

async function resolveEcwidStoreCurrency(storeId: string, token: string, warnings: string[]): Promise<string> {
  const envCurrency = (process.env.ECWID_CURRENCY || '').trim().toUpperCase();

  try {
    const url = `${ECWID_BASE_URL}/${storeId}/profile`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const body = await safeReadText(response);
      warnings.push(`Ecwid profile request failed (${response.status}): ${body}`);
      if (envCurrency) return envCurrency;
      throw new Error('Unable to resolve Ecwid store currency from profile endpoint. Set ECWID_CURRENCY.');
    }

    const profile = (await response.json()) as Record<string, unknown>;
    const currency = pickCurrencyFromProfile(profile);
    if (currency) {
      return currency;
    }

    if (envCurrency) {
      warnings.push('Ecwid profile did not expose currency; falling back to ECWID_CURRENCY.');
      return envCurrency;
    }

    throw new Error('Ecwid currency not found in profile response. Set ECWID_CURRENCY.');
  } catch (error) {
    if (envCurrency) {
      warnings.push('Falling back to ECWID_CURRENCY after Ecwid currency lookup error.');
      return envCurrency;
    }

    throw error;
  }
}

function pickCurrencyFromProfile(profile: Record<string, unknown>): string | null {
  const candidates: Array<unknown> = [
    profile.currency,
    asRecord(profile.settings)?.currency,
    asRecord(profile.settings)?.storeCurrency,
    asRecord(profile.formatsAndUnits)?.currency,
    asRecord(profile.regionalSettings)?.currency,
    asRecord(profile.businessAddress)?.currency,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const normalized = candidate.trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(normalized)) {
        return normalized;
      }
    }
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function isEcwidProductEnabled(product: EcwidProduct): boolean {
  const rawValue = product.enabled ?? product.product_is_available;

  if (typeof rawValue === 'boolean') return rawValue;
  if (typeof rawValue === 'string') {
    const normalized = rawValue.trim().toLowerCase();
    return normalized === 'true' || normalized === 'yes' || normalized === 'y';
  }

  return false;
}

function toMinorUnits(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100);
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.round(parsed * 100);
    }
  }

  return null;
}

async function listSquareCatalog(
  squareBaseUrl: string,
  squareAccessToken: string,
  squareVersion: string
): Promise<SquareCatalogListResponse> {
  const allObjects: SquareCatalogObject[] = [];
  let cursor: string | undefined;

  while (true) {
    const query = cursor ? `?types=ITEM,ITEM_VARIATION&cursor=${encodeURIComponent(cursor)}` : '?types=ITEM,ITEM_VARIATION';
    const response = await squareRequest<SquareCatalogListResponse>(
      squareBaseUrl,
      `/catalog/list${query}`,
      squareAccessToken,
      squareVersion,
      {
        method: 'GET',
      }
    );

    if (Array.isArray(response.objects)) {
      allObjects.push(...response.objects);
    }

    if (!response.cursor) {
      break;
    }

    cursor = response.cursor;
  }

  return { objects: allObjects };
}

function buildSquareVariationLookup(objects: SquareCatalogObject[]): Map<string, SquareVariationLookup> {
  const bySku = new Map<string, SquareVariationLookup>();

  for (const object of objects) {
    if (object.type !== 'ITEM_VARIATION') continue;
    const sku = String(object.item_variation_data?.sku || '').trim();
    if (!sku) continue;

    bySku.set(sku, {
      variation: object,
      itemId: object.item_variation_data?.item_id || null,
    });
  }

  return bySku;
}

function buildSquareItemLookup(objects: SquareCatalogObject[]): Map<string, SquareCatalogObject> {
  const byId = new Map<string, SquareCatalogObject>();

  for (const object of objects) {
    if (object.type !== 'ITEM') continue;
    byId.set(object.id, object);
  }

  return byId;
}

async function squareRequest<T>(
  squareBaseUrl: string,
  path: string,
  token: string,
  version: string,
  options: { method: 'GET' | 'POST'; body?: unknown }
): Promise<T> {
  const response = await fetch(`${squareBaseUrl}${path}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Square-Version': version,
      'Content-Type': 'application/json',
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!response.ok) {
    const body = await safeReadText(response);
    throw new Error(`Square request failed (${response.status}) for ${path}: ${body}`);
  }

  return (await response.json()) as T;
}

function sanitizeSkuForTempId(sku: string): string {
  const safe = sku.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 80);
  return safe || 'UNSPECIFIED_SKU';
}

function chunkArray<T>(values: T[], size: number): T[][] {
  if (size <= 0) return [values];

  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '[unable to read response body]';
  }
}
