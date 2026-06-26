import type { FavoriteSkuRecord } from '@/lib/favorites/sku-favorites';
import type { SelectedItem } from './ProductSelector';
import type { RepairFormData } from './RepairIntakeForm';

export interface EcwidSearchProduct {
  id: string;
  name: string;
  sku: string;
  price: number | null;
}

export interface FavoriteIntakeContext {
  ecwidProduct: EcwidSearchProduct | null;
  skuReasons: string[];
}

/** Live Ecwid product + SKU-specific issue labels for a repair favorite. */
export async function fetchFavoriteIntakeContext(
  favorite: FavoriteSkuRecord,
): Promise<FavoriteIntakeContext> {
  let ecwidProduct: EcwidSearchProduct | null = null;
  let skuReasons: string[] = [];

  try {
    const [ecwidRes, issuesRes] = await Promise.all([
      fetch(`/api/ecwid/products/search?q=${encodeURIComponent(favorite.sku)}`),
      fetch(`/api/repair/issues?favoriteSkuId=${favorite.id}`),
    ]);
    const ecwidData = await ecwidRes.json();
    const products: EcwidSearchProduct[] = Array.isArray(ecwidData?.products) ? ecwidData.products : [];
    ecwidProduct =
      products.find((p) => p.sku.trim().toLowerCase() === favorite.sku.trim().toLowerCase()) ??
      products[0] ??
      null;

    const issuesData = await issuesRes.json();
    if (Array.isArray(issuesData?.issues)) {
      skuReasons = issuesData.issues
        .filter((i: { favorite_sku_id: number | null }) => i.favorite_sku_id !== null)
        .map((i: { label: string }) => i.label);
    }
  } catch {
    // fall through — caller uses cached favorite fields
  }

  return { ecwidProduct, skuReasons };
}

export function buildDraftFromFavorite(
  favorite: FavoriteSkuRecord,
  ecwidProduct?: EcwidSearchProduct | null,
  preSelectedReasons?: string[],
): Partial<RepairFormData> {
  return {
    product: {
      type: 'Bose Repair Service',
      model: ecwidProduct?.name || favorite.productTitle || favorite.label || favorite.sku,
      sourceSku: ecwidProduct?.sku || favorite.sku,
    },
    repairReasons: preSelectedReasons?.length ? preSelectedReasons : [],
    repairNotes: favorite.issueTemplate || '',
    price:
      ecwidProduct?.price != null
        ? ecwidProduct.price.toFixed(2)
        : favorite.defaultPrice || '130',
    notes: favorite.notes || '',
  };
}

export function favoriteToSelectedItems(
  favorite: FavoriteSkuRecord,
  ecwidProduct?: EcwidSearchProduct | null,
): SelectedItem[] {
  const name = ecwidProduct?.name || favorite.productTitle || favorite.label || favorite.sku;
  const price =
    ecwidProduct?.price != null
      ? ecwidProduct.price
      : favorite.defaultPrice
        ? parseFloat(favorite.defaultPrice)
        : null;
  return [
    {
      id: `fav-${favorite.id}`,
      name,
      price: Number.isFinite(price) ? price : null,
      sku: ecwidProduct?.sku || favorite.sku,
    },
  ];
}
