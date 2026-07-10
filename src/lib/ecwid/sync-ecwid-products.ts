/**
 * Pure helpers for the Ecwid product-mirror sync
 * (POST /api/sku-catalog/sync-ecwid-products).
 *
 * Extracted DB-free so the parse / completeness / reconcile-missing logic is
 * unit-testable (reversibility plan 5.4 — deactivate pass must never run on a
 * truncated fetch). The route owns fetch + upsert; these functions own the
 * decisions.
 */

export interface EcwidMirrorProduct {
  ecwidProductId: string;
  sku: string | null;
  name: string;
  thumbnailUrl: string | null;
}

/** Parse one Ecwid `items` page into mirror products (drops id-less/name-less rows). */
export function parseEcwidProductItems(items: unknown): EcwidMirrorProduct[] {
  if (!Array.isArray(items)) return [];
  const out: EcwidMirrorProduct[] = [];
  for (const item of items) {
    if (item == null || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const ecwidProductId = String(rec.id || '').trim();
    const sku = String(rec.sku || '').trim() || null;
    const name = String(rec.name || '').trim();
    if (!ecwidProductId || !name) continue;
    out.push({
      ecwidProductId,
      sku,
      name,
      thumbnailUrl: typeof rec.thumbnailUrl === 'string' ? rec.thumbnailUrl : null,
    });
  }
  return out;
}

/**
 * A paginated fetch is COMPLETE only when it terminated on a short page
 * (fewer items than the page limit). Exhausting the page cap with a full
 * final page means the catalog may be truncated — the deactivate pass must
 * not run on such a fetch (never mass-deactivate on a partial view).
 */
export function isEcwidFetchComplete(lastPageItemCount: number, pageLimit: number): boolean {
  return lastPageItemCount < pageLimit;
}

/**
 * Reconcile-missing: given the org's currently-active ecwid platform rows and
 * the ids seen in the latest COMPLETE fetch, return the row ids to soft-
 * deactivate. Rows without a platform_item_id can't be reconciled — skipped.
 */
export function selectStaleEcwidRowIds(
  existingRows: Array<{ id: number; platform_item_id: string | null }>,
  fetchedItemIds: Iterable<string>,
): number[] {
  const fetched = new Set(fetchedItemIds);
  return existingRows
    .filter((row) => row.platform_item_id != null && row.platform_item_id !== '' && !fetched.has(row.platform_item_id))
    .map((row) => row.id);
}
