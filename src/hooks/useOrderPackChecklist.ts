'use client';

import { useQuery } from '@tanstack/react-query';
import type { OrderPackChecklistResult } from '@/lib/packing/order-pack-checklist';

export function orderPackChecklistQueryKey(
  orderRowId: number | null,
  skuFallback?: string | null,
) {
  return ['order-pack-checklist', orderRowId, skuFallback ?? null] as const;
}

/**
 * Fetches the order-scoped pack checklist. When orderRowId is missing but sku
 * is provided, hits the SKU fallback path on the same endpoint.
 */
export function useOrderPackChecklist(opts: {
  orderRowId: number | null;
  sku?: string | null;
  condition?: string | null;
  productTitle?: string | null;
  enabled?: boolean;
}) {
  const { orderRowId, sku, condition, productTitle, enabled = true } = opts;
  const hasOrder = orderRowId != null && orderRowId > 0;
  const hasSku = Boolean(sku?.trim());

  return useQuery<OrderPackChecklistResult>({
    queryKey: orderPackChecklistQueryKey(orderRowId, sku),
    enabled: enabled && (hasOrder || hasSku),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (!hasOrder && hasSku) {
        params.set('sku', sku!.trim());
        if (condition?.trim()) params.set('condition', condition.trim());
        if (productTitle?.trim()) params.set('title', productTitle.trim());
      }
      const id = hasOrder ? orderRowId : 0;
      const qs = params.toString();
      const res = await fetch(
        `/api/orders/${id}/pack-checklist${qs ? `?${qs}` : ''}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error('Failed to load pack checklist');
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || 'Failed to load pack checklist');
      return data as OrderPackChecklistResult;
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
