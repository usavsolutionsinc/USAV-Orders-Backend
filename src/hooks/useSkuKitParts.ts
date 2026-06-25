'use client';

import { useQuery } from '@tanstack/react-query';
import type { SkuCatalogRow, SkuKitPartRow } from '@/lib/neon/sku-catalog-queries';

export interface SkuKitPartsResult {
  catalog: SkuCatalogRow;
  parts: SkuKitPartRow[];
}

/**
 * Fetches the kit-parts BOM ("what's in the box") for a single SKU catalog id,
 * backing the Products → Kit Parts view's right-pane workspace. Returns the
 * catalog row (header) plus its kit-part rows (ALL conditions — the editor is
 * not condition-gated; condition gating happens at pack time). Disabled until a
 * SKU is selected (`skuCatalogId` null/undefined).
 */
export function useSkuKitParts(skuCatalogId: number | null | undefined) {
  return useQuery<SkuKitPartsResult>({
    queryKey: ['sku-kit-parts', skuCatalogId],
    enabled: typeof skuCatalogId === 'number' && skuCatalogId > 0,
    queryFn: async () => {
      const res = await fetch(`/api/sku-catalog/${skuCatalogId}/kit-parts`);
      if (!res.ok) throw new Error('Failed to load kit parts');
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || 'Failed to load kit parts');
      return { catalog: data.catalog, parts: Array.isArray(data.parts) ? data.parts : [] };
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
