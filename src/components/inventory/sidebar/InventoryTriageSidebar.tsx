'use client';

import { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@/hooks';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { cn } from '@/utils/_cn';
import { triageStatusChipClass } from '@/lib/inventory-triage-status';

/** Subset of the `tracking_exceptions` row the triage queue needs. */
export interface TriageRow {
    id: number;
    tracking_number: string;
    exception_reason: string | null;
    status: string;
    notes: string | null;
    staff_display_name: string | null;
    staff_name: string | null;
    source_station: string | null;
    receiving_source: string | null;
    created_at: string;
}

type TriageStatus = 'open' | 'resolved' | 'all';

const STATUS_ITEMS: HorizontalSliderItem[] = [
    { id: 'open', label: 'Open' },
    { id: 'resolved', label: 'Resolved' },
    { id: 'all', label: 'All' },
];

function relativeTime(iso: string | null): string {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(ms)) return '';
    const min = Math.floor(ms / 60_000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    if (min < 1440) return `${Math.floor(min / 60)}h ago`;
    return `${Math.floor(min / 1440)}d ago`;
}

export function useTriageList(q: string, status: TriageStatus) {
    return useQuery<TriageRow[]>({
        queryKey: ['triage-exceptions', q, status],
        queryFn: async ({ signal }) => {
            const sp = new URLSearchParams({ domain: 'receiving', status, limit: '100' });
            if (q) sp.set('q', q);
            const res = await fetch(`/api/tracking-exceptions?${sp.toString()}`, {
                signal,
                credentials: 'same-origin',
            });
            if (!res.ok) throw new Error(`tracking-exceptions ${res.status}`);
            const data = await res.json();
            return (data.rows ?? []) as TriageRow[];
        },
        staleTime: 15_000,
    });
}

/**
 * Sidebar for the inventory Triage mode (`/inventory/triage`). Lists real
 * `tracking_exceptions` (the triage queue). Selecting one writes `?open=<id>`,
 * which `TriageWorkspace` reads to load the full record into the right pane.
 */
export function InventoryTriageSidebar() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const openId = searchParams.get('open');

    const [status, setStatus] = useState<TriageStatus>('open');
    const [inputValue, setInputValue] = useState('');
    const trimmed = useDebounce(inputValue, 250).trim();

    const { data: rows = [], isFetching, isError } = useTriageList(trimmed, status);

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
                placeholder: 'Search by tracking number…',
                isSearching: isFetching,
                variant: 'blue',
            }}
            headerRows={[
                <HorizontalButtonSlider
                    key="status"
                    items={STATUS_ITEMS}
                    value={status}
                    onChange={(id) => setStatus(id as TriageStatus)}
                    variant="nav"
                    dense
                    className="w-full"
                    aria-label="Triage status"
                />,
            ]}
            bodyClassName="scrollbar-hide pb-5 space-y-2"
        >
            <p className={`${microBadge} px-1 text-text-soft`}>
                {rows.length > 0
                    ? `${rows.length} ${status === 'open' ? 'open ' : ''}issue${rows.length !== 1 ? 's' : ''}`
                    : 'Triage queue — unmatched / flagged tracking'}
            </p>

            {isError ? (
                <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center">
                    <p className={`${microBadge} text-rose-600`}>
                        Couldn’t load the triage queue (you may need receiving access).
                    </p>
                </div>
            ) : null}

            {!isError && rows.length === 0 && !isFetching ? (
                <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-6 text-center">
                    <p className={`${microBadge} text-text-soft`}>No {status === 'all' ? '' : status} issues.</p>
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
                                    'ds-raw-button flex w-full flex-col items-start gap-1 rounded-lg px-2.5 py-2 text-left transition-colors',
                                    active ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : 'hover:bg-surface-hover',
                                )}
                            >
                                <div className="flex w-full items-center justify-between gap-2">
                                    <span
                                        className={cn(
                                            'truncate font-mono text-label font-semibold',
                                            active ? 'text-blue-900' : 'text-text-default',
                                        )}
                                    >
                                        {row.tracking_number}
                                    </span>
                                    <span
                                        className={cn(
                                            'shrink-0 rounded px-1.5 py-0.5 text-eyebrow font-bold uppercase tracking-wide ring-1 ring-inset',
                                            triageStatusChipClass(row.status),
                                        )}
                                    >
                                        {row.status}
                                    </span>
                                </div>
                                <div className="flex w-full items-center justify-between gap-2 text-caption text-text-soft">
                                    <span className="truncate">
                                        {row.exception_reason || 'Exception'}
                                        {row.source_station ? ` · ${row.source_station}` : ''}
                                    </span>
                                    <span className="shrink-0">{relativeTime(row.created_at)}</span>
                                </div>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </SidebarShell>
    );
}

export default InventoryTriageSidebar;
