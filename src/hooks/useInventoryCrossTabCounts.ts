'use client';

import { useQueries } from '@tanstack/react-query';
import type { InventoryTab } from '@/lib/inventory-search';

/**
 * Lightweight count probes across non-current inventory tabs.
 *
 * Used by the cross-tab handoff card: when the user searches for "A12" on
 * Bins, we want to surface "Try this in Units (8)" when another tab has more
 * matches. Each tab calls its existing read endpoint with `limit=1` (or
 * leans on the response's `total`/`counts.total` field where available) so
 * the probe is cheap.
 */
export interface InventoryCrossTabCounts {
    bins: number | null;
    skus: number | null;
    units: number | null;
    activity: number | null;
    alerts: number | null;
    counts: number | null;
    /** Whether the value for a tab is capped (e.g. sku-search returns max 20). */
    capped: Partial<Record<InventoryTab, boolean>>;
    isFetching: boolean;
}

const TABS: InventoryTab[] = ['bins', 'skus', 'units', 'activity', 'alerts', 'counts'];

async function probeTab(
    tab: InventoryTab,
    query: string,
    signal?: AbortSignal,
): Promise<{ count: number | null; capped: boolean }> {
    const trimmed = query.trim();
    if (!trimmed) return { count: null, capped: false };

    try {
        switch (tab) {
            case 'bins': {
                const res = await fetch(
                    `/api/inventory/bins-overview?q=${encodeURIComponent(trimmed)}`,
                    { signal },
                );
                if (!res.ok) return { count: null, capped: false };
                const data = (await res.json()) as { counts?: { total?: number } };
                return { count: data.counts?.total ?? 0, capped: false };
            }
            case 'skus': {
                const res = await fetch(
                    `/api/inventory/sku-search?q=${encodeURIComponent(trimmed)}`,
                    { signal },
                );
                if (!res.ok) return { count: null, capped: false };
                const data = (await res.json()) as { results?: unknown[] };
                const n = data.results?.length ?? 0;
                return { count: n, capped: n >= 20 };
            }
            case 'units': {
                const res = await fetch(
                    `/api/inventory/units?q=${encodeURIComponent(trimmed)}&limit=1`,
                    { signal },
                );
                if (!res.ok) return { count: null, capped: false };
                const data = (await res.json()) as { total?: number };
                return { count: data.total ?? 0, capped: false };
            }
            case 'activity': {
                const res = await fetch(
                    `/api/inventory-events?sku=${encodeURIComponent(trimmed)}&limit=50`,
                    { signal },
                );
                if (!res.ok) return { count: null, capped: false };
                const data = (await res.json()) as { events?: unknown[] };
                const n = data.events?.length ?? 0;
                return { count: n, capped: n >= 50 };
            }
            case 'alerts': {
                const res = await fetch(
                    `/api/inventory/alerts?q=${encodeURIComponent(trimmed)}&limit=1`,
                    { signal },
                );
                if (!res.ok) return { count: null, capped: false };
                const data = (await res.json()) as { counts?: { total?: number } };
                return { count: data.counts?.total ?? 0, capped: false };
            }
            case 'counts': {
                const res = await fetch(
                    `/api/inventory/counts?q=${encodeURIComponent(trimmed)}&limit=1`,
                    { signal },
                );
                if (!res.ok) return { count: null, capped: false };
                const data = (await res.json()) as { counts?: { total?: number } };
                return { count: data.counts?.total ?? 0, capped: false };
            }
            default:
                return { count: null, capped: false };
        }
    } catch {
        return { count: null, capped: false };
    }
}

export function useInventoryCrossTabCounts(args: {
    query: string;
    currentTab: InventoryTab;
}): InventoryCrossTabCounts {
    const trimmed = args.query.trim();
    const enabled = trimmed.length > 0;

    const results = useQueries({
        queries: TABS.filter((t) => t !== args.currentTab).map((tab) => ({
            queryKey: ['inventory-cross-tab-count', tab, trimmed] as const,
            queryFn: async ({ signal }: { signal?: AbortSignal }) => {
                const probe = await probeTab(tab, trimmed, signal);
                return { tab, ...probe };
            },
            enabled,
            staleTime: 30_000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnMount: false,
            refetchOnReconnect: false,
        })),
    });

    const out: InventoryCrossTabCounts = {
        bins: null,
        skus: null,
        units: null,
        activity: null,
        alerts: null,
        counts: null,
        capped: {},
        isFetching: results.some((r) => r.isFetching),
    };

    for (const r of results) {
        const data = r.data;
        if (!data) continue;
        out[data.tab] = data.count;
        if (data.capped) out.capped[data.tab] = true;
    }

    return out;
}
