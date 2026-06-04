'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useDebounce } from '@/hooks';
import { useInventorySearch, type InventoryResultRow } from '@/hooks/useInventorySearch';
import { useInventoryCrossTabCounts } from '@/hooks/useInventoryCrossTabCounts';
import { useInventoryRecentSearches } from '@/hooks/useInventoryRecentSearches';
import { useInventoryUrlState } from '@/components/inventory/useInventoryUrlState';
import {
    INVENTORY_BUCKETS,
    type AnyInventoryBucket,
    type AnyInventorySearchField,
    type InventoryTab,
} from '@/lib/inventory-search';
import {
    INVENTORY_DETAILS_EVENTS,
    dispatchOpenInventoryDetails,
    serializeInventoryOpenKey,
    type InventoryDetailKind,
    type NavigateInventoryDetailsPayload,
} from '@/lib/inventory-events-channel';
import { microBadge } from '@/design-system/tokens/typography/presets';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import {
    INVENTORY_SEARCH_FIELDS,
    getInventorySearchPlaceholder,
    getInventorySearchHelperText,
} from '@/lib/inventory-search';
import { InventorySidebarTabs } from './InventorySidebarTabs';
import { FIELD_ICON } from './InventoryScopedSearchBar';
import { InventoryBucketFilterChips } from './InventoryBucketFilterChips';
import { InventoryCrossTabHandoffCard } from './InventoryCrossTabHandoffCard';
import { InventoryResultList } from './InventoryResultList';
import { InventoryRecentSearches } from './InventoryRecentSearches';
import { InventorySidebarFooter } from './InventorySidebarFooter';

function detailRefForRow(row: InventoryResultRow): { kind: InventoryDetailKind; ref: string } | null {
    switch (row.kind) {
        case 'bin':
            return { kind: 'bin', ref: row.row.barcode || row.row.name || String(row.row.id) };
        case 'sku':
            return { kind: 'sku', ref: row.row.sku };
        case 'unit':
            return { kind: 'unit', ref: row.row.serial_number || String(row.row.id) };
        case 'event':
            if (row.row.sku) return { kind: 'sku', ref: row.row.sku };
            if (row.row.serial_number) return { kind: 'unit', ref: row.row.serial_number };
            if (row.row.bin_name) return { kind: 'bin', ref: row.row.bin_name };
            return null;
        case 'alert':
            return { kind: 'alert', ref: String(row.row.id) };
        case 'count':
            return { kind: 'count', ref: String(row.row.id) };
        default:
            return null;
    }
}

function openKeyForRow(row: InventoryResultRow): string | null {
    const target = detailRefForRow(row);
    return target ? serializeInventoryOpenKey(target.kind, target.ref) : null;
}

export interface InventorySidebarProps {
    /** When mounted as a section panel, omits the white aside chrome. */
    embedded?: boolean;
}

/**
 * Tabbed inventory sidebar — top-level orchestrator. Owns:
 *   - input/debounce state for the search box
 *   - URL sync (tab, field, bucket filter, query, open detail key)
 *   - TanStack subscription via `useInventorySearch`
 *   - recent-searches persistence per tab
 *
 * Row clicks in Phase 1 still drive the legacy ledger viewport (sku/bin/unit
 * query params on `/inventory`). Phase 2 swaps to a slide-in detail panel
 * via the `open-inventory-details` custom event.
 */
export function InventorySidebar({ embedded = true }: InventorySidebarProps) {
    const { sidebar, setSidebarUrl } = useInventoryUrlState();
    const { tab, field, buckets, open: openKey, q: urlQuery } = sidebar;

    const [inputValue, setInputValue] = useState<string>(urlQuery);
    const debouncedQuery = useDebounce(inputValue, 250);
    const trimmedQuery = debouncedQuery.trim();

    // Re-sync the input when the tab changes externally (e.g. a sub-route page
    // mounted with a different tab) — but don't fight the user mid-typing.
    useEffect(() => {
        setInputValue(urlQuery);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab]);

    // Write the committed query upstream.
    useEffect(() => {
        if (trimmedQuery === sidebar.q) return;
        setSidebarUrl({ q: trimmedQuery || null });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trimmedQuery]);

    const search = useInventorySearch({
        tab,
        query: trimmedQuery,
        field,
        buckets,
    });

    const crossTab = useInventoryCrossTabCounts({
        query: trimmedQuery,
        currentTab: tab,
    });

    const recent = useInventoryRecentSearches(tab);

    // Persist a recent search entry once results resolve for a non-empty query.
    useEffect(() => {
        if (!trimmedQuery || search.isFetching) return;
        recent.push({
            query: trimmedQuery,
            field,
            resultCount: search.rows.length,
        });
        // Only when query/result count actually changes — push() dedupes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trimmedQuery, search.isFetching, search.rows.length]);

    const handleTabChange = useCallback(
        (next: InventoryTab) => {
            if (next === tab) return;
            setSidebarUrl({ tab: next });
        },
        [setSidebarUrl, tab],
    );

    const handleFieldChange = useCallback(
        (next: AnyInventorySearchField) => {
            setSidebarUrl({ field: next });
        },
        [setSidebarUrl],
    );

    const handleBucketsChange = useCallback(
        (next: AnyInventoryBucket[]) => {
            setSidebarUrl({ buckets: next });
        },
        [setSidebarUrl],
    );

    // Row clicks dispatch the open-inventory-details event which the
    // InventoryDetailsOverlay listens for. URL `open=<kind>:<publicRef>`
    // tracks the active selection so deep-links auto-open on mount.
    const handleSelect = useCallback(
        (row: InventoryResultRow) => {
            const target = detailRefForRow(row);
            const key = openKeyForRow(row);
            if (target && key) {
                dispatchOpenInventoryDetails({ ...target, listKey: key });
                setSidebarUrl({ open: key });
            }
        },
        [setSidebarUrl],
    );

    // Navigate prev/next: walk the current result list and re-dispatch open
    // for the neighboring row. Falls back to no-op when the panel is open on
    // a row that's no longer in the active results (e.g. after a tab swap).
    const rowsRef = useRef<InventoryResultRow[]>([]);
    rowsRef.current = search.rows;

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<NavigateInventoryDetailsPayload>).detail;
            const direction = detail?.direction === 'up' ? -1 : 1;
            const rows = rowsRef.current;
            if (rows.length === 0 || !openKey) return;
            const idx = rows.findIndex((r) => openKeyForRow(r) === openKey);
            if (idx < 0) return;
            const next = rows[idx + direction];
            if (!next) return;
            const target = detailRefForRow(next);
            const nextKey = openKeyForRow(next);
            if (target && nextKey) {
                dispatchOpenInventoryDetails({ ...target, listKey: nextKey });
                setSidebarUrl({ open: nextKey });
            }
        };
        window.addEventListener(INVENTORY_DETAILS_EVENTS.NAVIGATE, handler);
        return () => window.removeEventListener(INVENTORY_DETAILS_EVENTS.NAVIGATE, handler);
    }, [openKey, setSidebarUrl]);

    // Clear URL `?open=` when the overlay closes (panel close button or ESC).
    useEffect(() => {
        const handler = () => {
            if (openKey) setSidebarUrl({ open: null });
        };
        window.addEventListener(INVENTORY_DETAILS_EVENTS.CLOSE, handler);
        return () => window.removeEventListener(INVENTORY_DETAILS_EVENTS.CLOSE, handler);
    }, [openKey, setSidebarUrl]);

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
    };
    const itemVariants = {
        hidden: { opacity: 0, x: -20, filter: 'blur(4px)' },
        visible: {
            opacity: 1,
            x: 0,
            filter: 'blur(0px)',
            transition: { type: 'spring', damping: 25, stiffness: 350, mass: 0.5 },
        },
    };

    const activeBucketCount = buckets.length;
    const hasBucketFilters = INVENTORY_BUCKETS[tab].length > 0;

    const fieldItems: HorizontalSliderItem[] = INVENTORY_SEARCH_FIELDS[tab].map((f) => ({
        id: f.id,
        label: f.label,
        icon: FIELD_ICON[f.id],
    }));

    const panelContent = (
        <SidebarShell
            as={motion.div}
            containerProps={{ initial: 'hidden', animate: 'visible', variants: containerVariants }}
            search={{
                value: inputValue,
                onChange: setInputValue,
                placeholder: getInventorySearchPlaceholder(tab, field),
                isSearching: search.isFetching,
                variant: 'blue',
            }}
            headerRows={[
                // Row: tab pills — ACTIVITY / BINS / SKUs / UNITS / …
                <InventorySidebarTabs key="tabs" value={tab} onChange={handleTabChange} />,
                // Row: field-scope pills — ALL / SKU / BIN / USER / …
                <HorizontalButtonSlider
                    key="field"
                    items={fieldItems}
                    value={field}
                    onChange={(id) => handleFieldChange(id as AnyInventorySearchField)}
                    variant="nav"
                    dense
                    className="w-full"
                    aria-label={`${tab} search field`}
                />,
                // Row: bucket filter chips (conditional)
                hasBucketFilters ? (
                    <InventoryBucketFilterChips
                        key="buckets"
                        tab={tab}
                        value={buckets}
                        onChange={handleBucketsChange}
                        counts={search.counts}
                    />
                ) : null,
            ]}
            bodyClassName="scrollbar-hide pb-5 space-y-4"
        >
            {/* Scroll area: helper text + cross-tab + results + recent + footer */}
            <motion.div variants={itemVariants} initial="hidden" animate="visible" className="contents">
                <p className={`${microBadge} text-gray-500 px-1`}>
                    {getInventorySearchHelperText(tab, field)}
                </p>
                {trimmedQuery.length > 0 ? (
                    <InventoryCrossTabHandoffCard
                        currentTab={tab}
                        currentCount={search.rows.length}
                        counts={crossTab}
                        onJump={(nextTab) => setSidebarUrl({ tab: nextTab })}
                    />
                ) : null}
                <InventoryResultList
                    rows={search.rows}
                    isFetching={search.isFetching}
                    hasQuery={trimmedQuery.length > 0}
                    isRowActive={(row) => openKeyForRow(row) === openKey}
                    onSelect={handleSelect}
                    onClearQuery={() => setInputValue('')}
                    label={
                        search.rows.length > 0
                            ? `${search.rows.length} Result${search.rows.length !== 1 ? 's' : ''}${activeBucketCount > 0 ? ` · ${activeBucketCount} filter${activeBucketCount !== 1 ? 's' : ''}` : ''}`
                            : undefined
                    }
                    emptyPlaceholder={
                        tab === 'alerts' || tab === 'counts' ? (
                            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center">
                                <p className={`${microBadge} text-gray-500`}>
                                    {tab === 'alerts'
                                        ? 'No open alerts — pick a bucket above to view resolved ones'
                                        : 'No cycle count campaigns yet'}
                                </p>
                            </div>
                        ) : undefined
                    }
                />
                <InventoryRecentSearches
                    tab={tab}
                    show={search.rows.length === 0}
                    onSelect={(q) => setInputValue(q)}
                />
                <InventorySidebarFooter />
            </motion.div>
        </SidebarShell>
    );

    if (embedded) return panelContent;

    return (
        <aside className="bg-white text-gray-900 flex-shrink-0 h-full overflow-hidden border-r border-gray-200 w-[300px]">
            {panelContent}
        </aside>
    );
}
