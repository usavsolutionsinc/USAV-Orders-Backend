'use client';

import { useQuery } from '@tanstack/react-query';

export interface ItemSearchResult {
  id: string;
  sku: string;
  name: string;
}

export function useItemsSearch(query: string) {
  const q = query.trim();
  return useQuery<ItemSearchResult[]>({
    queryKey: ['inventory', 'items-search', q],
    enabled: q.length >= 1,
    queryFn: async () => {
      const res = await fetch(`/api/inventory/items/search?q=${encodeURIComponent(q)}&limit=20`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Search failed');
      return data.items as ItemSearchResult[];
    },
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}
