'use client';

import { useQuery } from '@tanstack/react-query';
import type { PartsGraphResponse } from './types';

async function fetchPartsGraph(): Promise<PartsGraphResponse> {
  const res = await fetch('/api/inventory/parts-graph');
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data as PartsGraphResponse;
}

export function usePartsGraph() {
  return useQuery<PartsGraphResponse>({
    queryKey: ['inventory', 'parts-graph'],
    queryFn: fetchPartsGraph,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
