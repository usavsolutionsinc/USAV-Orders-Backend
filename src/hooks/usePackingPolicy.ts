'use client';

import { useQuery } from '@tanstack/react-query';
import type { PackingEnforcement } from '@/lib/tenancy/settings';

export interface PackingPolicy {
  enforcement: PackingEnforcement;
}

/**
 * Reads the org's packing-checklist enforcement mode (GET /api/packing/policy)
 * so packer surfaces can apply block_until_matched. Org-level + slow-changing,
 * so it's cached for 5 min. Falls back to 'advisory' until loaded.
 */
export function usePackingPolicy() {
  return useQuery<PackingPolicy>({
    queryKey: ['packing-policy'],
    queryFn: async () => {
      const res = await fetch('/api/packing/policy');
      if (!res.ok) throw new Error('Failed to load packing policy');
      const data = await res.json();
      return { enforcement: data?.enforcement === 'block_until_matched' ? 'block_until_matched' : 'advisory' };
    },
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
}
