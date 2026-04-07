'use client';

import { useQuery } from '@tanstack/react-query';

export interface SquareCustomer {
  id: string;
  given_name?: string;
  family_name?: string;
  phone_number?: string;
  email_address?: string;
  created_at?: string;
}

export function useSquareCustomerSearch(query?: string | null) {
  const trimmed = (query || '').trim();

  return useQuery<SquareCustomer[]>({
    queryKey: ['square-customers', trimmed],
    queryFn: async () => {
      const res = await fetch(
        `/api/walk-in/customers?q=${encodeURIComponent(trimmed)}`,
      );
      if (!res.ok) throw new Error('Failed to search customers');
      const data = await res.json();
      return data.customers || [];
    },
    enabled: trimmed.length > 1,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });
}
