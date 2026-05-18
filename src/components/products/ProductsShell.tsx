'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ProductsToolbar, type ActiveFilter } from './ProductsToolbar';
import { ProductsTable } from './ProductsTable';
import type { ProductListRow, ProductsListResponse } from './types';

const PAGE_SIZE = 100;

interface ListParams {
    q: string;
    activeFilter: ActiveFilter;
    hasEcwid: boolean;
}

function parseActiveFilter(raw: string | null): ActiveFilter {
    return raw === 'active' || raw === 'inactive' ? raw : 'all';
}

function buildSearchParams(params: ListParams, offset: number): URLSearchParams {
    const sp = new URLSearchParams();
    if (params.q) sp.set('q', params.q);
    if (params.activeFilter !== 'all') {
        sp.set('active', params.activeFilter === 'active' ? 'true' : 'false');
    }
    if (params.hasEcwid) sp.set('hasEcwid', 'true');
    sp.set('limit', String(PAGE_SIZE));
    sp.set('offset', String(offset));
    return sp;
}

export function ProductsShell() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const params = useMemo<ListParams>(
        () => ({
            q: searchParams.get('q') || '',
            activeFilter: parseActiveFilter(searchParams.get('active')),
            hasEcwid: searchParams.get('hasEcwid') === 'true',
        }),
        [searchParams],
    );

    const [rows, setRows] = useState<ProductListRow[]>([]);
    const [total, setTotal] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Tracks the active fetch so a stale response (after filters change)
    // is discarded instead of stomping the latest result.
    const requestIdRef = useRef(0);

    const fetchPage = useCallback(
        async (offset: number, append: boolean) => {
            const requestId = ++requestIdRef.current;
            if (append) setLoadingMore(true);
            else setLoading(true);
            setError(null);

            try {
                const sp = buildSearchParams(params, offset);
                const res = await fetch(`/api/products?${sp.toString()}`, {
                    credentials: 'same-origin',
                });
                if (!res.ok) {
                    let message = `HTTP ${res.status}`;
                    try {
                        const body = await res.json();
                        if (body?.error) message = body.error;
                    } catch {
                        // ignore JSON parse failure
                    }
                    throw new Error(message);
                }
                const payload: ProductsListResponse = await res.json();
                if (!payload.success) {
                    throw new Error('Server reported failure');
                }
                if (requestId !== requestIdRef.current) return; // stale
                setRows((prev) => (append ? [...prev, ...payload.items] : payload.items));
                setTotal(payload.total);
            } catch (err: unknown) {
                if (requestId !== requestIdRef.current) return;
                const message = err instanceof Error ? err.message : 'Failed to load products';
                setError(message);
                if (!append) {
                    setRows([]);
                    setTotal(null);
                }
            } finally {
                if (requestId === requestIdRef.current) {
                    setLoading(false);
                    setLoadingMore(false);
                }
            }
        },
        [params],
    );

    // Fetch page 0 whenever filters change.
    useEffect(() => {
        fetchPage(0, false);
    }, [fetchPage]);

    const updateUrl = useCallback(
        (next: Partial<ListParams>) => {
            const merged: ListParams = { ...params, ...next };
            const sp = new URLSearchParams();
            if (merged.q) sp.set('q', merged.q);
            if (merged.activeFilter !== 'all') sp.set('active', merged.activeFilter);
            if (merged.hasEcwid) sp.set('hasEcwid', 'true');
            const qs = sp.toString();
            router.replace(qs ? `${pathname}?${qs}` : pathname);
        },
        [params, pathname, router],
    );

    const hasMore = total !== null && rows.length < total;

    const handleLoadMore = useCallback(() => {
        if (!hasMore || loadingMore) return;
        fetchPage(rows.length, true);
    }, [hasMore, loadingMore, fetchPage, rows.length]);

    return (
        <div className="flex h-full min-h-0 flex-col bg-gray-50">
            <ProductsToolbar
                q={params.q}
                onQChange={(next) => updateUrl({ q: next })}
                activeFilter={params.activeFilter}
                onActiveFilterChange={(next) => updateUrl({ activeFilter: next })}
                hasEcwid={params.hasEcwid}
                onHasEcwidChange={(next) => updateUrl({ hasEcwid: next })}
                total={total}
                shown={rows.length}
            />
            <div className="flex-1 overflow-y-auto">
                <ProductsTable
                    rows={rows}
                    isLoading={loading && rows.length === 0}
                    isFetchingMore={loadingMore}
                    hasMore={hasMore}
                    onLoadMore={handleLoadMore}
                    error={error}
                />
            </div>
        </div>
    );
}
