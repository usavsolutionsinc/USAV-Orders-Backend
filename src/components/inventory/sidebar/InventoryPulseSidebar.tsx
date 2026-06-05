'use client';

import { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@/hooks';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { inventoryStatusBadgeClass } from '@/components/inventory/status-classes';
import type { UnitListRow, UnitListResponse } from '@/components/inventory/types';
import { cn } from '@/utils/_cn';

function useUnitsList(q: string) {
    return useQuery<UnitListRow[]>({
        queryKey: ['pulse-units', q],
        queryFn: async ({ signal }) => {
            const sp = new URLSearchParams({ limit: '50' });
            if (q) sp.set('q', q);
            const res = await fetch(`/api/inventory/units?${sp.toString()}`, {
                signal,
                credentials: 'same-origin',
            });
            if (!res.ok) throw new Error(`inventory/units ${res.status}`);
            const data = (await res.json()) as UnitListResponse;
            return data.items ?? [];
        },
        staleTime: 15_000,
    });
}

/**
 * Sidebar for the inventory Pulse mode (`/inventory/pulse`). Lists real
 * `serial_units` (most-recently-touched first). Selecting one writes
 * `?open=<serialUnitId>`, which `PulseWorkspace` reads to load that unit's
 * chain-of-custody (`/api/inventory-events?serial_unit_id=`) in the right pane.
 */
export function InventoryPulseSidebar() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const openId = searchParams.get('open');

    const [inputValue, setInputValue] = useState('');
    const trimmed = useDebounce(inputValue, 250).trim();

    const { data: rows = [], isFetching, isError } = useUnitsList(trimmed);

    const select = useCallback(
        (id: number) => {
            const sp = new URLSearchParams(searchParams.toString());
            sp.set('open', String(id));
            router.replace(`${pathname}?${sp.toString()}`);
        },
        [router, pathname, searchParams],
    );

    const containerVariants = useMemo(
        () => ({
            hidden: { opacity: 0 },
            visible: { opacity: 1, transition: { staggerChildren: 0.03, delayChildren: 0.03 } },
        }),
        [],
    );

    return (
        <SidebarShell
            as={motion.div}
            containerProps={{ initial: 'hidden', animate: 'visible', variants: containerVariants }}
            search={{
                value: inputValue,
                onChange: setInputValue,
                placeholder: 'Search serial, SKU, or title…',
                isSearching: isFetching,
                variant: 'blue',
            }}
            bodyClassName="scrollbar-hide pb-5 space-y-2"
        >
            <p className={`${microBadge} px-1 text-gray-500`}>
                {rows.length > 0
                    ? `${rows.length} unit${rows.length !== 1 ? 's' : ''} · newest activity first`
                    : 'Pick a unit to trace its full chain of custody'}
            </p>

            {isError ? (
                <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center">
                    <p className={`${microBadge} text-rose-600`}>Couldn’t load units.</p>
                </div>
            ) : null}

            {!isError && rows.length === 0 && !isFetching ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
                    <p className={`${microBadge} text-gray-500`}>No units match.</p>
                </div>
            ) : null}

            <ul className="space-y-1">
                {rows.map((row) => {
                    const active = String(row.id) === openId;
                    return (
                        <li key={row.id}>
                            <button
                                type="button"
                                onClick={() => select(row.id)}
                                className={cn(
                                    'flex w-full flex-col items-start gap-1 rounded-lg px-2.5 py-2 text-left transition-colors',
                                    active ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : 'hover:bg-gray-50',
                                )}
                            >
                                <div className="flex w-full items-center justify-between gap-2">
                                    <span
                                        className={cn(
                                            'truncate font-mono text-[12px] font-semibold',
                                            active ? 'text-blue-900' : 'text-gray-900',
                                        )}
                                    >
                                        {row.serial_number}
                                    </span>
                                    <span
                                        className={cn(
                                            'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide',
                                            inventoryStatusBadgeClass(row.current_status),
                                        )}
                                    >
                                        {row.current_status}
                                    </span>
                                </div>
                                <div className="flex w-full items-center justify-between gap-2 text-[11px] text-gray-500">
                                    <span className="truncate">
                                        {row.sku ? `${row.sku} · ` : ''}
                                        {row.product_title || '—'}
                                    </span>
                                    {row.current_location ? (
                                        <span className="shrink-0 font-mono">{row.current_location}</span>
                                    ) : null}
                                </div>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </SidebarShell>
    );
}

export default InventoryPulseSidebar;
