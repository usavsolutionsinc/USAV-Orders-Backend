export type SearchField = 'ecwid_sku' | 'zoho_sku' | 'title';

/**
 * Pick the right search field for the SKU catalog based on the shape of the
 * query. SKUs in this system are numeric (e.g. 98, 00804, 04767), so a
 * digit-only input or short hyphen/digit string is treated as a SKU; anything
 * with a space or three-or-more consecutive letters is treated as a title.
 */
export function detectSkuCatalogSearchField(query: string): SearchField {
  const trimmed = query.trim();
  if (!trimmed) return 'ecwid_sku';
  if (/\s/.test(trimmed)) return 'title';
  if (/^[0-9-]+$/.test(trimmed)) return 'ecwid_sku';
  if (/[A-Za-z]{3,}/.test(trimmed)) return 'title';
  return 'ecwid_sku';
}
