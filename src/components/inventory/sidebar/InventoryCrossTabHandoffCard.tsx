'use client';

import { Activity, AlertTriangle, Barcode, Box, ClipboardList, Tool } from '@/components/Icons';
import { microBadge, sectionLabel } from '@/design-system/tokens/typography/presets';
import type { InventoryTab } from '@/lib/inventory-search';
import type { InventoryCrossTabCounts, CrossTabCountTab } from '@/hooks/useInventoryCrossTabCounts';

const TAB_LABEL: Record<CrossTabCountTab, string> = {
    activity: 'Activity',
    bins: 'Bins',
    skus: 'SKUs',
    units: 'Units',
    alerts: 'Alerts',
    counts: 'Counts',
};

const TAB_ICON: Record<CrossTabCountTab, (p: { className?: string }) => JSX.Element> = {
    activity: Activity,
    bins: Box,
    skus: Barcode,
    units: Tool,
    alerts: AlertTriangle,
    counts: ClipboardList,
};

interface InventoryCrossTabHandoffCardProps {
    /** Currently active tab — excluded from the suggestion list. */
    currentTab: InventoryTab;
    /** Count returned for the current tab (drives the "more matches" decision). */
    currentCount: number;
    /** Counts probed for the non-current tabs. */
    counts: InventoryCrossTabCounts;
    onJump: (tab: InventoryTab) => void;
}

/**
 * Surfaces "more matches in {tab}" when the current tab's result count is
 * smaller than another tab's. Mirrors `DashboardShippedSearchHandoffCard`.
 */
export function InventoryCrossTabHandoffCard({
    currentTab,
    currentCount,
    counts,
    onJump,
}: InventoryCrossTabHandoffCardProps) {
    const candidates = (Object.entries(counts) as Array<[string, number | null]>)
        .filter(([k]) => k !== 'capped' && k !== 'isFetching' && k !== currentTab)
        .map(([tab, count]) => ({
            tab: tab as CrossTabCountTab,
            count: typeof count === 'number' ? count : 0,
            capped: Boolean(counts.capped?.[tab as CrossTabCountTab]),
        }))
        .filter((c) => c.count > currentCount)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);

    if (candidates.length === 0) return null;

    return (
        <section className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
                <p className={`${sectionLabel} text-blue-700`}>More matches</p>
                <p className={`${microBadge} text-blue-500`}>{candidates.length} tab{candidates.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
                {candidates.map(({ tab, count, capped }) => {
                    const Icon = TAB_ICON[tab];
                    return (
                        <button
                            key={tab}
                            type="button"
                            onClick={() => onJump(tab)}
                            className="ds-raw-button flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-white px-2.5 py-2 text-left transition-colors hover:border-blue-400 hover:bg-blue-100"
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <Icon className="h-4 w-4 text-blue-600" />
                                <span className="text-eyebrow font-bold uppercase tracking-wide text-blue-900">
                                    {TAB_LABEL[tab]}
                                </span>
                            </span>
                            <span className={`${microBadge} rounded-full bg-blue-100 px-2 py-0.5 text-blue-700`}>
                                {count}{capped ? '+' : ''}
                            </span>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
