'use client';

import { useQuery } from '@tanstack/react-query';

export interface SkuCatalogItem {
  id: number;
  sku: string;
  product_title: string;
  category: string | null;
  upc: string | null;
  image_url: string | null;
  is_active: boolean;
}

export interface UseSkuCatalogSearchOptions {
  limit?: number;
  /** When true, fetch even when query is empty (server returns top-N). */
  allowEmpty?: boolean;
  /** When true, restrict to SKUs that have an active ECWID pairing row. */
  ecwidOnly?: boolean;
  /** Exclude SKUs whose sku ends with this suffix (e.g. '-RS' for repairs). */
  excludeSkuSuffix?: string;
}

export function useSkuCatalogSearch(
  query: string | null | undefined,
  limitOrOptions: number | UseSkuCatalogSearchOptions = 20,
) {
  const options: Required<
    Pick<UseSkuCatalogSearchOptions, 'limit' | 'allowEmpty' | 'ecwidOnly' | 'excludeSkuSuffix'>
  > =
    typeof limitOrOptions === 'number'
      ? { limit: limitOrOptions, allowEmpty: false, ecwidOnly: false, excludeSkuSuffix: '' }
      : {
          limit: limitOrOptions.limit ?? 20,
          allowEmpty: !!limitOrOptions.allowEmpty,
          ecwidOnly: !!limitOrOptions.ecwidOnly,
          excludeSkuSuffix: limitOrOptions.excludeSkuSuffix ?? '',
        };
  const q = (query || '').trim();
  return useQuery<SkuCatalogItem[]>({
    queryKey: [
      'sku-catalog-search',
      q,
      options.limit,
      options.allowEmpty,
      options.ecwidOnly,
      options.excludeSkuSuffix,
    ],
    enabled: options.allowEmpty || q.length > 0,
    queryFn: async () => {
      const params = new URLSearchParams({ q, limit: String(options.limit) });
      if (options.ecwidOnly) params.set('ecwidOnly', 'true');
      if (options.excludeSkuSuffix) params.set('excludeSkuSuffix', options.excludeSkuSuffix);
      const res = await fetch(`/api/sku-catalog/search?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to search SKU catalog');
      const data = await res.json();
      return Array.isArray(data?.items) ? data.items : [];
    },
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });
}
