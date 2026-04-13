'use client';

import { useQuery } from '@tanstack/react-query';
import type { SearchField } from '@/lib/detectSearchField';

export type { SearchField } from '@/lib/detectSearchField';

export interface SkuCatalogItem {
  id: number;
  sku: string;
  zoho_sku: string | null;
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
  /** Which field to search: ecwid_sku (default), zoho_sku, or title (display_name). */
  searchField?: SearchField;
}

export function useSkuCatalogSearch(
  query: string | null | undefined,
  limitOrOptions: number | UseSkuCatalogSearchOptions = 20,
) {
  const options: Required<
    Pick<UseSkuCatalogSearchOptions, 'limit' | 'allowEmpty' | 'ecwidOnly' | 'excludeSkuSuffix' | 'searchField'>
  > =
    typeof limitOrOptions === 'number'
      ? { limit: limitOrOptions, allowEmpty: false, ecwidOnly: false, excludeSkuSuffix: '', searchField: 'ecwid_sku' }
      : {
          limit: limitOrOptions.limit ?? 20,
          allowEmpty: !!limitOrOptions.allowEmpty,
          ecwidOnly: !!limitOrOptions.ecwidOnly,
          excludeSkuSuffix: limitOrOptions.excludeSkuSuffix ?? '',
          searchField: limitOrOptions.searchField ?? 'ecwid_sku',
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
      options.searchField,
    ],
    enabled: options.allowEmpty || q.length > 0,
    queryFn: async () => {
      const params = new URLSearchParams({ q, limit: String(options.limit) });
      if (options.ecwidOnly) params.set('ecwidOnly', 'true');
      if (options.excludeSkuSuffix) params.set('excludeSkuSuffix', options.excludeSkuSuffix);
      if (options.searchField !== 'ecwid_sku') params.set('searchField', options.searchField);
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
