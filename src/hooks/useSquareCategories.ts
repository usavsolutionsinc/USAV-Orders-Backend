'use client';

import { useQuery } from '@tanstack/react-query';

export interface SquareCategory {
  id: string;
  name: string;
}

export function useSquareCategories() {
  return useQuery<SquareCategory[]>({
    queryKey: ['square-categories'],
    queryFn: async () => {
      const res = await fetch('/api/walk-in/categories');
      if (!res.ok) throw new Error('Failed to fetch categories');
      const data = await res.json();
      return data.categories || [];
    },
    staleTime: 30 * 60 * 1000, // 30 min — categories rarely change
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
