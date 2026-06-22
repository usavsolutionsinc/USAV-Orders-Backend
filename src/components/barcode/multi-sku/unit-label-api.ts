import { normalizeSku } from '@/utils/sku';

/**
 * Pure network layer for the unit-label workspace. No React — each function
 * fetches an endpoint and returns a normalized result (or throws), so the
 * controller hook owns only setState orchestration. Independently testable.
 */

/** Normalized product info from /api/get-title-by-sku. `title` is raw ('' when
 *  missing) so callers can apply their own fallback (e.g. `|| 'Not found'`). */
export interface ProductInfo {
  title: string;
  stock: string;
  location: string;
  imageUrl: string;
  skuCatalogId: number | null;
}

export interface NextUnitId {
  unitId: string;
  gtin: string;
}

export interface IssuedUnit {
  serial: string;
  unitUid: string | null;
}

/** Raw /api/units/resolve-id response (reprint path). */
export interface ResolvedUnitId {
  ok?: boolean;
  unitUid?: string | null;
  gtin?: string;
  sku: string;
  productTitle?: string;
  skuCatalogId?: number | null;
  error?: string;
}

/**
 * Look up product title/stock/location/image by SKU. Strips a `:`-suffixed
 * variant qualifier before querying. Throws on network failure — callers map
 * the rejection to their own "Error loading info" fallback.
 */
export async function lookupProductInfo(skuValue: string): Promise<ProductInfo> {
  const baseSku = skuValue.includes(':') ? skuValue.split(':')[0] : skuValue;
  const res = await fetch(`/api/get-title-by-sku?sku=${encodeURIComponent(normalizeSku(baseSku))}`);
  const data = await res.json();
  return {
    title: data.title || '',
    stock: data.stock || '0',
    location: data.location || '',
    imageUrl: data.imageUrl || '',
    skuCatalogId: typeof data.skuCatalogId === 'number' ? data.skuCatalogId : null,
  };
}

/**
 * Allocate the next unit-id for a SKU. Each call atomically increments the
 * per-SKU-per-year sequence (no pre-flight peek). The GS1 Digital Link in the
 * response is intentionally ignored — products labels encode the bare unit id.
 */
export async function allocateNextUnitId(
  skuValue: string,
  catalogIdHint?: number | null,
): Promise<NextUnitId> {
  const body: Record<string, unknown> = { sku: normalizeSku(skuValue) };
  if (catalogIdHint && Number.isFinite(catalogIdHint)) {
    body.sku_catalog_id = catalogIdHint;
  }
  const res = await fetch('/api/units/next-id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || 'next-id failed');
  }
  return { unitId: data.unitId, gtin: data.gtin ?? '' };
}

/**
 * Resolve an existing unit-id to its catalog row (reprint; no sequence
 * allocation). Throws on a non-2xx response so the caller falls back to a plain
 * SKU lookup; otherwise returns the raw payload (check `.ok` before trusting it).
 */
export async function resolveUnitId(unitId: string): Promise<ResolvedUnitId> {
  const res = await fetch('/api/units/resolve-id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unitId }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'resolve-id failed');
  }
  return data as ResolvedUnitId;
}

/**
 * Issue labels to the canonical pipeline (serial_units + activity logs +
 * tech_serial_numbers + a LABELED inventory_event per unit). The route mints one
 * unit_uid per serial and returns them — those are the ids each label encodes.
 */
export async function postMultiSn(payload: {
  sku: string;
  productSku: string;
  unitId: string;
  gtin?: string;
  qrPayload: string;
  symbology: string;
  serialNumbers: string[];
  notes: string;
  location: string;
  condition: string;
  printClass: 'print' | 'sn-to-sku';
}): Promise<{ success: boolean; units: IssuedUnit[] }> {
  const res = await fetch('/api/post-multi-sn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  return { success: !!data.success, units: Array.isArray(data.units) ? data.units : [] };
}
