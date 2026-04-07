'use client';

import { useQuery } from '@tanstack/react-query';

export interface SquareCatalogItem {
  id: string;
  type: string;
  item_data?: {
    name?: string;
    description?: string;
    categories?: Array<{ id: string; ordinal?: number }>;
    variations?: Array<{
      id: string;
      item_variation_data?: {
        sku?: string;
        name?: string;
        price_money?: { amount?: number; currency?: string };
      };
    }>;
  };
}

export function useSquareCatalog(search?: string | null, categoryId?: string | null) {
  return useQuery<SquareCatalogItem[]>({
    queryKey: ['square-catalog', search || '', categoryId || ''],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (categoryId) params.set('category', categoryId);
      const qs = params.toString();
      const url = `/api/walk-in/catalog${qs ? `?${qs}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch catalog');
      const data = await res.json();
      return data.items || [];
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });
}
