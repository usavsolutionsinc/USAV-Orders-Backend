'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, Loader2, MapPin, Package } from '@/components/Icons';
import { getLast4, SerialChip, SkuScanRefChip } from '@/components/ui/CopyChip';
import { EventRow } from './EventRow';
import { inventoryStatusBadgeClass } from './status-classes';
import type { PulseEventRow, PulseEventsResponse } from './types';
import { cn } from '@/utils/_cn';

interface PulseWorkspaceProps {
    /** `?open=` — the serial_unit id selected in the sidebar. */
    unitId: string | null;
}

export function PulseWorkspace({ unitId }: PulseWorkspaceProps) {
    const { data, isLoading, isError, error } = useQuery<PulseEventRow[]>({
        queryKey: ['pulse-unit-events', unitId],
        enabled: !!unitId,
        queryFn: async ({ signal }) => {
            const res = await fetch(`/api/inventory-events?serial_unit_id=${unitId}&limit=200`, {
                signal,
                credentials: 'same-origin',
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = (await res.json()) as PulseEventsResponse;
            return body.events ?? [];
        },
    });

    // The API may return either order; sort newest-first for the timeline and to
    // derive the unit's current identity from its latest event.
    const events = useMemo(
        () =>
            [...(data ?? [])].sort(
                (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
            ),
        [data],
    );
    const latest = events[0] ?? null;
    const currentStatus = latest?.next_status ?? latest?.prev_status ?? null;
    const currentLocation = events.find((e) => e.bin_name)?.bin_name ?? null;
    const serial = latest?.serial_number ?? null;
    const sku = latest?.sku ?? null;
    const productTitle = events.find((e) => e.product_title)?.product_title ?? null;
    const heroTitle = productTitle || serial || `Unit #${unitId}`;

    if (!unitId) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-gray-50 text-gray-400">
                <div className="space-y-2 text-center">
                    <History className="mx-auto h-12 w-12 opacity-20" />
                    <p className="text-sm font-medium">Select a unit from the sidebar to see its trace history</p>
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-gray-50 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="ml-2 text-sm">Loading chain of custody…</span>
            </div>
        );
    }

    if (isError) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-gray-50">
                <div className="mx-6 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {error instanceof Error ? error.message : 'Failed to load unit history.'}
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full w-full flex-col overflow-y-auto bg-white">
            <div className="mx-auto w-full max-w-4xl p-8">
                {/* Identity */}
                <div className="mb-8 flex items-end justify-between border-b border-gray-100 pb-6">
                    <div className="flex items-center gap-4">
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200">
                            <Package className="h-7 w-7" />
                        </div>
                        <div className="min-w-0 space-y-2">
                            {/* Product title on top; serial + SKU are copy chips
                                (last-4, click to copy the full value) below. */}
                            <h1 className="truncate text-2xl font-black tracking-tight text-gray-900">
                                {heroTitle}
                            </h1>
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                                {sku ? (
                                    <SkuScanRefChip value={sku} display={getLast4(sku)} />
                                ) : null}
                                {serial ? (
                                    <SerialChip value={serial} width="w-auto shrink-0" />
                                ) : null}
                                {currentStatus ? (
                                    <span
                                        className={cn(
                                            'rounded px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide',
                                            inventoryStatusBadgeClass(currentStatus),
                                        )}
                                    >
                                        {currentStatus}
                                    </span>
                                ) : null}
                            </div>
                        </div>
                    </div>
                    {currentLocation ? (
                        <div className="flex flex-col items-end gap-1">
                            <p className="text-micro font-black uppercase tracking-[0.2em] text-gray-400">
                                Last known location
                            </p>
                            <div className="flex items-center gap-2 rounded-2xl border border-orange-100 bg-orange-50 px-4 py-2">
                                <MapPin className="h-4 w-4 text-orange-600" />
                                <span className="font-mono text-sm font-black text-orange-700">
                                    {currentLocation}
                                </span>
                            </div>
                        </div>
                    ) : null}
                </div>

                {/* Chain of custody */}
                <h2 className="mb-3 flex items-center gap-2 text-caption font-black uppercase tracking-[0.2em] text-gray-400">
                    <History className="h-4 w-4" /> Chain of custody
                    <span className="font-bold text-gray-300">· {events.length} events</span>
                </h2>

                {events.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-12 text-center text-sm text-gray-400">
                        No recorded events for this unit yet.
                    </div>
                ) : (
                    <ul role="list" className="overflow-hidden rounded-2xl border border-gray-100">
                        {events.map((event) => (
                            <EventRow key={event.id} event={event} />
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
