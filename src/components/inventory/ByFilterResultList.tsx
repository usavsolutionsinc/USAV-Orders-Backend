'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import type { UnitListResponse, UnitListRow } from './types';
import { inventoryStatusBadgeClass } from './status-classes';

const PAGE_SIZE = 100;

interface ByFilterResultListProps {
    states: string[];
    conditions: string[];
}

function relativeTime(iso: string | null): string {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
    if (diffMin < 10080) return `${Math.floor(diffMin / 1440)}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ByFilterResultList({ states, conditions }: ByFilterResultListProps) {
    const [rows, setRows] = useState<UnitListRow[]>([]);
    const [total, setTotal] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const requestIdRef = useRef(0);

    const fetchPage = useCallback(
        async (offset: number, append: boolean) => {
            const requestId = ++requestIdRef.current;
            if (append) setLoadingMore(true);
            else setLoading(true);
            setError(null);

            try {
                const sp = new URLSearchParams();
                if (states.length > 0) sp.set('state', states.join(','));
                if (conditions.length > 0) sp.set('condition', conditions.join(','));
                sp.set('limit', String(PAGE_SIZE));
                sp.set('offset', String(offset));
                const res = await fetch(`/api/inventory/units?${sp.toString()}`, {
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
                const payload: UnitListResponse = await res.json();
                if (!payload.success) throw new Error('Server reported failure');
                if (requestId !== requestIdRef.current) return; // stale
                setRows((prev) => (append ? [...prev, ...payload.items] : payload.items));
                setTotal(payload.total);
            } catch (err: unknown) {
                if (requestId !== requestIdRef.current) return;
                const message = err instanceof Error ? err.message : 'Failed to load units';
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
        [states, conditions],
    );

    useEffect(() => {
        fetchPage(0, false);
    }, [fetchPage]);

    const hasMore = total !== null && rows.length < total;

    if (loading && rows.length === 0) {
        return (
            <div className="flex items-center justify-center py-16 text-text-faint">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="ml-2 text-sm">Loading units…</span>
            </div>
        );
    }

    if (error && rows.length === 0) {
        return (
            <div className="mx-4 my-8 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:mx-6">
                {error}
            </div>
        );
    }

    return (
        <section>
            <header className="flex items-center justify-between px-4 py-2 sm:px-6">
                <div>
                    <h2 className="text-sm font-semibold text-text-default">
                        Filtered units
                    </h2>
                    <p className="text-xs text-text-soft">
                        {total !== null
                            ? `${rows.length.toLocaleString()} of ${total.toLocaleString()}`
                            : `${rows.length.toLocaleString()}`}{' '}
                        match{total === 1 ? '' : 'es'}
                    </p>
                </div>
            </header>

            {rows.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-text-faint sm:px-6">
                    No units match these filters.
                </div>
            ) : (
                <ul role="list">
                    {rows.map((row) => (
                        <UnitRow key={row.id} row={row} />
                    ))}
                </ul>
            )}

            {hasMore ? (
                <div className="flex justify-center py-4">
                    <Button
                        variant="secondary"
                        size="sm"
                        loading={loadingMore}
                        onClick={() => fetchPage(rows.length, true)}
                        className="disabled:cursor-wait"
                    >
                        Load more
                    </Button>
                </div>
            ) : rows.length > 0 ? (
                <div className="py-4 text-center text-xs text-text-faint">End of results</div>
            ) : null}
        </section>
    );
}

function UnitRow({ row }: { row: UnitListRow }) {
    const unitHref = `/inventory?unit=${row.id}`;
    const skuHref = row.sku ? `/inventory?sku=${encodeURIComponent(row.sku)}` : null;
    const binHref = row.current_location
        ? `/inventory?bin=${encodeURIComponent(row.current_location)}`
        : null;
    const statusTone = inventoryStatusBadgeClass(row.current_status);

    return (
        <li className="flex items-start gap-3 border-b border-border-hairline px-4 py-2.5 hover:bg-blue-50/40 sm:px-6">
            <Link
                href={unitHref}
                className="min-w-0 flex-1"
            >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-mono text-xs text-text-soft">#{row.id}</span>
                    <span className="font-mono text-xs text-text-default">{row.serial_number}</span>
                    <span className={`rounded px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide ${statusTone}`}>
                        {row.current_status}
                    </span>
                    {row.condition_grade ? (
                        <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-micro font-medium uppercase tracking-wide text-text-muted">
                            {row.condition_grade.replace('_', ' ')}
                        </span>
                    ) : null}
                </div>
                <div className="mt-0.5 truncate text-sm text-text-default">
                    {row.product_title || row.sku || '—'}
                </div>
            </Link>

            <div className="flex shrink-0 flex-col items-end gap-0.5 text-caption text-text-soft">
                {skuHref ? (
                    <Link
                        href={skuHref}
                        className="font-mono text-blue-700 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {row.sku}
                    </Link>
                ) : null}
                {binHref ? (
                    <Link
                        href={binHref}
                        className="hover:underline"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {row.current_location}
                    </Link>
                ) : (
                    <span className="text-text-faint">no location</span>
                )}
                <span>{relativeTime(row.updated_at)}</span>
            </div>
        </li>
    );
}
