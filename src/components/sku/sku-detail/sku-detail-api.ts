import type { SkuDetailData } from './sku-detail-types';

/** Pure network layer for the SKU detail view. Throws with server messages. */

export async function fetchSkuDetail(sku: string): Promise<SkuDetailData> {
  const res = await fetch(`/api/sku-stock/${encodeURIComponent(sku)}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || 'Failed to load');
  return json as SkuDetailData;
}

export async function patchSkuStock(sku: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/sku-stock/${encodeURIComponent(sku)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await res.json();
    throw new Error(json?.error || 'Update failed');
  }
}

/**
 * Deactivate (soft-delete) a catalog SKU. Non-destructive — inventory / platform
 * ids / ledger rows are kept; the SKU just drops out of active lists. A 409
 * means it still has bin stock.
 */
export async function deactivateSkuCatalog(catalogId: number): Promise<void> {
  const res = await fetch(`/api/sku-catalog/${catalogId}`, { method: 'DELETE' });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new Error(body?.error || `Deactivate failed (${res.status})`);
  }
}
