'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  SkuGraphMode,
  SkuRelationshipEdgeView,
  SkuTreeResult,
} from './types';

const BASE = '/api/sku-catalog/graph';

async function getJson(url: string) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export function useSkuParents(skuId: number | null | undefined) {
  return useQuery<SkuRelationshipEdgeView[]>({
    queryKey: ['sku-graph', 'parents', skuId],
    enabled: typeof skuId === 'number' && skuId > 0,
    queryFn: async () => (await getJson(`${BASE}/${skuId}/parents`)).parents ?? [],
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useSkuChildren(skuId: number | null | undefined) {
  return useQuery<SkuRelationshipEdgeView[]>({
    queryKey: ['sku-graph', 'children', skuId],
    enabled: typeof skuId === 'number' && skuId > 0,
    queryFn: async () => (await getJson(`${BASE}/${skuId}/children`)).children ?? [],
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useSkuTree(skuId: number | null | undefined, depth = 10) {
  return useQuery<SkuTreeResult>({
    queryKey: ['sku-graph', 'tree', skuId, depth],
    enabled: typeof skuId === 'number' && skuId > 0,
    queryFn: async () => {
      const data = await getJson(`${BASE}/${skuId}/tree?depth=${depth}`);
      return {
        root_sku_id: data.root_sku_id,
        edges: data.edges ?? [],
        nodes: data.nodes ?? [],
      };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/** Convenience wrapper that picks the right read for the active mode. */
export function useSkuGraphData(skuId: number | null, mode: SkuGraphMode) {
  const parents = useSkuParents(mode === 'parents' ? skuId : null);
  const children = useSkuChildren(mode === 'children' ? skuId : null);
  const tree = useSkuTree(mode === 'tree' ? skuId : null);
  if (mode === 'parents') return parents;
  if (mode === 'children') return children;
  return tree;
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export interface CreateRelationshipInput {
  parentSkuId: number;
  childSkuId: number;
  qty?: number;
  notes?: string | null;
}

export function useSkuRelationshipMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['sku-graph'] });

  const create = useMutation({
    mutationFn: async (input: CreateRelationshipInput) => {
      const res = await fetch(`${BASE}/relationships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Failed to add connection');
      return data.relationship;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async (args: { id: number; qty?: number; notes?: string | null }) => {
      const { id, ...body } = args;
      const res = await fetch(`${BASE}/relationships/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Failed to update connection');
      return data.relationship;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/relationships/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Failed to remove connection');
      return true;
    },
    onSuccess: invalidate,
  });

  return { create, update, remove };
}
