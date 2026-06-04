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
import { FIELD_ICON } from './inventory-sidebar-metadata';
import { InventorySidebarFilters } from './InventorySidebarFilters';
import { ViewDropdown, type ViewDropdownOption } from '@/components/ui/ViewDropdown';
import { InventoryCrossTabHandoffCard } from './InventoryCrossTabHandoffCard';
import { InventoryResultList } from './InventoryResultList';
import { InventoryRecentSearches } from './InventoryRecentSearches';
import { InventorySidebarFooter } from './InventorySidebarFooter';
import { useMemo } from 'react';

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
    const { mode, tab, field, buckets, open: openKey, q: urlQuery } = sidebar;

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

    // Refinement Mapping
    const refinements = useMemo(() => {
        const out: Array<{ id: string; label: string; onRemove: () => void }> = [];
        // Only show field as a refinement if it's NOT 'all'
        if (field !== 'all') {
            const fieldLabel = INVENTORY_SEARCH_FIELDS[tab].find((f) => f.id === field)?.label || field;
            out.push({
                id: 'field',
                label: `By: ${fieldLabel}`,
                onRemove: () => handleFieldChange('all'),
            });
        }
        // Add status buckets
        buckets.forEach((bId) => {
            const bucketLabel = INVENTORY_BUCKETS[tab].find((b) => b.id === bId)?.label || bId;
            out.push({
                id: bId,
                label: bucketLabel,
                onRemove: () => handleBucketsChange(buckets.filter((v) => v !== bId)),
            });
        });
        return out;
    }, [field, buckets, tab, handleFieldChange, handleBucketsChange]);

    const modeOptions: ReadonlyArray<ViewDropdownOption<any>> = [
        { value: 'ledger', label: 'Inventory Ledger' },
        { value: 'triage', label: 'Exception Triage' },
        { value: 'pulse', label: 'Lifecycle Pulse' },
    ];

    const panelContent = (
        <SidebarShell
            as={motion.div}
            containerProps={{ initial: 'hidden', animate: 'visible', variants: containerVariants }}
            headerAbove={
                <ViewDropdown
                    options={modeOptions}
                    value={mode}
                    onChange={(m) => setSidebarUrl({ mode: m })}
                    variant="boxy"
                    buttonClassName="h-14 w-full border-b border-gray-200 bg-white px-4 pr-12 text-left text-xs uppercase tracking-[0.2em] font-black text-gray-900 outline-none transition-colors hover:bg-gray-50"
                />
            }
            search={{
                value: inputValue,
                onChange: setInputValue,
                placeholder: getInventorySearchPlaceholder(tab, field),
                isSearching: search.isFetching,
                variant: 'blue',
            }}
            filter={{
                label: 'Search Filters',
                refinements,
                onClearAll: () => {
                    handleFieldChange('all');
                    handleBucketsChange([]);
                },
                renderDropdown: (onClose) => (
                    <InventoryFilterDropdown
                        tab={tab}
                        field={field}
                        onFieldChange={handleFieldChange}
                        buckets={buckets}
                        onBucketsChange={handleBucketsChange}
                        counts={search.counts}
                        onClose={onClose}
                    />
                ),
            }}
            headerRows={[
                // Row: tab pills — only in ledger mode
                mode === 'ledger' ? (
                    <InventorySidebarTabs key="tabs" value={tab} onChange={handleTabChange} />
                ) : null,
            ].filter(Boolean) as React.ReactNode[]}
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
