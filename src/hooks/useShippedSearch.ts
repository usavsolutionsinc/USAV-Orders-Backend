'use client';

import { useQuery } from '@tanstack/react-query';
import { useLast8TrackingSearch } from '@/hooks/useLast8TrackingSearch';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import type { ShippedSearchField } from '@/lib/shipped-search';

export type ShippedTypeFilter = 'all' | 'orders' | 'sku' | 'fba';

export interface ShippedSearchMeta {
    outOfScope: boolean;
    outOfScopeSuggestion: { filter: ShippedTypeFilter; count: number } | null;
}

export interface UseShippedSearchParams {
    /** The (already debounced/committed) query string. Empty disables the network call. */
    query: string;
    shippedFilter?: ShippedTypeFilter;
    searchField?: ShippedSearchField;
    packedBy?: number;
    testedBy?: number;
}

export interface ShippedSearchResponse {
    records: ShippedOrder[];
    meta: ShippedSearchMeta;
}

function normalizeShippedOrder(order: any): ShippedOrder {
    const primaryTracking = order.shipping_tracking_number || order.tracking_number || null;
    return {
        ...order,
        packed_at: order.packed_at || null,
        packed_by: order.packed_by ?? null,
        tested_by: order.tested_by ?? null,
        serial_number: order.serial_number || '',
        condition: order.condition || '',
        shipping_tracking_number: primaryTracking,
    } as ShippedOrder;
}

async function callShippedSearch(
    args: {
        q: string;
        shippedFilter?: ShippedTypeFilter;
        searchField?: ShippedSearchField;
        packedBy?: number;
        testedBy?: number;
    },
    signal?: AbortSignal,
): Promise<ShippedSearchResponse> {
    const params = new URLSearchParams();
    params.set('q', args.q);
    if (args.shippedFilter && args.shippedFilter !== 'all') params.set('shippedFilter', args.shippedFilter);
    if (args.searchField && args.searchField !== 'all') params.set('searchField', args.searchField);
    if (args.packedBy !== undefined) params.set('packedBy', String(args.packedBy));
    if (args.testedBy !== undefined) params.set('testedBy', String(args.testedBy));

    const res = await fetch(`/api/shipped?${params.toString()}`, { signal });
    if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.details || data?.error || 'Failed to search shipped orders');
    }
    const data = await res.json();
    const raw = Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data?.shipped)
            ? data.shipped
            : Array.isArray(data?.orders)
                ? data.orders
                : [];
    return {
        records: raw.map(normalizeShippedOrder),
        meta: {
            outOfScope: Boolean(data?.outOfScope),
            outOfScopeSuggestion: data?.outOfScopeSuggestion ?? null,
        },
    };
}

/**
 * Universal shipped-orders search subscription. All consumers (sidebar, dashboard table, etc.)
 * pass the same params → same TanStack Query key → one network call, one cache entry,
 * identical results everywhere. Pass an already-debounced `query` string in.
 *
 * Industry-standard pattern: input state lives in the input component, debounce happens
 * before this hook receives `query`, the hook owns the network layer and caching.
 */
export function useShippedSearch(params: UseShippedSearchParams) {
    const trimmed = params.query.trim();
    const { normalizeTrackingQuery } = useLast8TrackingSearch();

    return useQuery({
        queryKey: [
            'shipped-search',
            trimmed,
            params.shippedFilter ?? 'all',
            params.searchField ?? 'all',
            params.packedBy ?? null,
            params.testedBy ?? null,
        ] as const,
        queryFn: async ({ signal }) => {
            const initial = await callShippedSearch(
                {
                    q: trimmed,
                    shippedFilter: params.shippedFilter,
                    searchField: params.searchField,
                    packedBy: params.packedBy,
                    testedBy: params.testedBy,
                },
                signal,
            );
            // Tracking-number fallback: if the raw query returned nothing and last-8
            // normalization differs, retry once with the normalized form.
            if (initial.records.length === 0) {
                const normalized = normalizeTrackingQuery(trimmed);
                if (normalized && normalized !== trimmed) {
                    return callShippedSearch(
                        {
                            q: normalized,
                            shippedFilter: params.shippedFilter,
                            searchField: params.searchField,
                            packedBy: params.packedBy,
                            testedBy: params.testedBy,
                        },
                        signal,
                    );
                }
            }
            return initial;
        },
        enabled: trimmed.length > 0,
        staleTime: 30_000,
        gcTime: 5 * 60 * 1000,
        placeholderData: (prev) => prev,
        // User-initiated search — don't refetch on window focus or remount.
        // Auto-refetch on focus would re-fire downstream side effects (history
        // save, auto-open/close) and visibly close open panels on tab return.
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
    });
}
