'use client';

import { useQuery } from '@tanstack/react-query';
import type { QcCheckTemplateRow, SkuCatalogRow } from '@/lib/neon/sku-catalog-queries';

export interface SkuQcChecksResult {
  catalog: SkuCatalogRow;
  checks: QcCheckTemplateRow[];
}

/**
 * Fetches the QC checklist for a single SKU catalog id, backing the QC view's
 * right-pane workspace. Returns the catalog row (header) plus its check steps.
 * Disabled until a SKU is selected (`skuCatalogId` null/undefined).
 */
export function useSkuQcChecks(skuCatalogId: number | null | undefined) {
  return useQuery<SkuQcChecksResult>({
    queryKey: ['sku-qc-checks', skuCatalogId],
    enabled: typeof skuCatalogId === 'number' && skuCatalogId > 0,
    queryFn: async () => {
      const res = await fetch(`/api/sku-catalog/${skuCatalogId}/qc-checks`);
      if (!res.ok) throw new Error('Failed to load QC checklist');
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || 'Failed to load QC checklist');
      return { catalog: data.catalog, checks: Array.isArray(data.checks) ? data.checks : [] };
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
