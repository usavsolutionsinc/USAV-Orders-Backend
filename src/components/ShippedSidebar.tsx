'use client';

import { ReactNode, useState, useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
    Search,
    Copy,
    Check,
    Plus,
} from './Icons';
import { motion, AnimatePresence } from 'framer-motion';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { ShippedIntakeForm, type ShippedFormData } from './shipped';
import { ShippedDetailsPanel } from './shipped/ShippedDetailsPanel';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { Button, IconButton } from '@/design-system/primitives';
import { useShippedSearch } from '@/hooks/useShippedSearch';
import { useDebounce } from '@/hooks';
import { formatDateTimePST } from '@/utils/date';
import { dispatchCloseShippedDetails, dispatchOpenShippedDetails, getOpenShippedDetailsPayload, DASHBOARD_SHIPPED_FOCUS_SEARCH_PARAM } from '@/utils/events';
import { RecentSearchesList } from '@/components/sidebar/RecentSearchesList';
import { getStaffName } from '@/utils/staff';
import { sectionLabel, microBadge } from '@/design-system/tokens/typography/presets';
import {
    getShippedSearchPlaceholder,
    type ShippedSearchField,
} from '@/lib/shipped-search';
import { useShippedFilterRefinements, ShippedFilterDropdown } from '@/components/shipping/ShippedFilterToolbar';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { ShippedActionsButton } from '@/components/shipped/ShippedActionsButton';
import { OutboundStatusLegend } from '@/components/shipped/OutboundStatusLegend';
import { FirstScanOnboardingCard } from '@/components/dashboard/FirstScanOnboardingCard';
import { ThroughputRoiCard } from '@/components/dashboard/ThroughputRoiCard';
import { useAiQuickJump } from '@/hooks/useAiQuickJump';
import { AiQuickJumpResults } from '@/components/search/AiQuickJumpResults';

interface SearchHistory {
    query: string;
    timestamp: Date;
    resultCount?: number;
}

type ShippedTypeFilter = 'all' | 'orders' | 'sku' | 'fba';

interface ShippedSidebarProps {
    showIntakeForm?: boolean;
    onCloseForm?: () => void;
    onFormSubmit?: (data: ShippedFormData) => void;
    filterControl?: ReactNode;
    showDetailsPanel?: boolean;
    embedded?: boolean;
    hideSectionHeader?: boolean;
    searchValue?: string;
    onSearchChange?: (value: string) => void;
    shippedFilter?: ShippedTypeFilter;
    onShippedFilterChange?: (value: ShippedTypeFilter) => void;
    shippedSearchField?: ShippedSearchField;
    onShippedSearchFieldChange?: (value: ShippedSearchField) => void;
    /** Embedded dashboard only: focuses shipped search bar once when URL includes `focusShippedSearch=1`. */
    autoFocusSearch?: boolean;
}


export default function ShippedSidebar({
    showIntakeForm = false,
    onCloseForm,
    onFormSubmit,
    filterControl,
    showDetailsPanel = true,
    embedded = false,
    hideSectionHeader = false,
    searchValue = '',
    onSearchChange,
    shippedFilter = 'all',
    onShippedFilterChange,
    shippedSearchField = 'all',
    onShippedSearchFieldChange,
    autoFocusSearch = false,
}: ShippedSidebarProps) {
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    // Scan-Out moved to the Unshipped sidebar (the seam where a packed/staged
    // order hands off to the carrier), so Shipped is list-only now — no view
    // toggle here.
    // Industry-standard search pipeline:
    //   1) Input owns its own state (`inputValue`). Nothing else writes to it.
    //   2) `useDebounce` collapses keystrokes into a committed value (250ms quiet period).
    //   3) `useShippedSearch` (TanStack Query) owns the network + cache. Same key in
    //      DashboardShippedTable = one shared fetch, identical results everywhere.
    //   4) The URL is downstream — we write the committed value upstream after debounce;
    //      we never read it back into the input. No more bidirectional sync, no echo loop.
    const [inputValue, setInputValue] = useState(searchValue);
    const debouncedQuery = useDebounce(inputValue, 250);
    const trimmedQuery = debouncedQuery.trim();

    // Filter Bar Integration
    const { refinements, clearAll } = useShippedFilterRefinements();

    const searchResult = useShippedSearch({
        query: trimmedQuery,
        // The Shipped tab now shows only order-type records; SKU / FBA get their
        // own sub-pages, so the type-filter pills were removed and the slice is
        // fixed to orders.
        shippedFilter: 'orders',
        searchField: shippedSearchField,
    });
    const results: ShippedOrder[] = searchResult.data?.records ?? [];

    // AI quick-jump (AI search Phase 2): cross-entity hybrid hits ride along
    // the same input. Flag-gated inside the hook — off/no-permission/failed
    // means zero hits and this sidebar is byte-identical to the classic
    // shipped search. pageContext soft-boosts ORDER hits; no hard scope, so
    // a serial/tracking typed here can still jump to a unit or carton.
    const aiQuickJump = useAiQuickJump(trimmedQuery, { pageContext: pathname, limit: 5 });
    const isSearching = searchResult.isFetching;
    const hasSearched = trimmedQuery.length > 0;

    const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
    const [showAllSearchHistory, setShowAllSearchHistory] = useState(false);
    const [selectedShipped, setSelectedShipped] = useState<ShippedOrder | null>(null);
    const [copiedId, setCopiedId] = useState<number | null>(null);
    const searchHistoryStorageKey = embedded && hideSectionHeader ? 'dashboard_search_history' : 'shipped_search_history';

    // Stable ref for upstream URL writes — parent recreates `setSearch` after every
    // router.replace; the ref keeps this effect from re-firing on identity churn.
    const onSearchChangeRef = useRef(onSearchChange);
    onSearchChangeRef.current = onSearchChange;
    useEffect(() => {
        onSearchChangeRef.current?.(trimmedQuery);
    }, [trimmedQuery]);

    // Side effects per resolved search: persist to history + auto-open the single match
    // when running standalone (NOT on dashboard — the table inline shows the row and
    // closing the panel here would yank any unrelated open panel).
    // Keyed off the trimmed query so refetches don't re-fire side effects.
    const lastHandledQueryRef = useRef<string | null>(null);
    useEffect(() => {
        const data = searchResult.data;
        if (!data || !trimmedQuery) return;
        if (lastHandledQueryRef.current === trimmedQuery) return;
        lastHandledQueryRef.current = trimmedQuery;

        const records = data.records;
        setSearchHistory((current) => {
            const next: SearchHistory[] = [
                { query: trimmedQuery, timestamp: new Date(), resultCount: records.length },
                ...current.filter((h) => h.query !== trimmedQuery).slice(0, 4),
            ];
            localStorage.setItem(searchHistoryStorageKey, JSON.stringify(next));
            return next;
        });

        if (records.length === 1 && pathname !== '/dashboard') {
            dispatchOpenShippedDetails(records[0], 'shipped');
            setSelectedShipped(records[0]);
        }
    }, [searchResult.data, trimmedQuery, pathname, searchHistoryStorageKey]);

    /** One-shot strip of `focusShippedSearch` from URL after the input mounts with autoFocus */
    useEffect(() => {
        if (!embedded || !autoFocusSearch) return;
        let cancelled = false;
        const timer = window.setTimeout(() => {
            if (cancelled) return;
            const params = new URLSearchParams(searchParams.toString());
            if (!params.has(DASHBOARD_SHIPPED_FOCUS_SEARCH_PARAM)) return;
            params.delete(DASHBOARD_SHIPPED_FOCUS_SEARCH_PARAM);
            const qs = params.toString();
            router.replace(qs ? `${pathname || '/dashboard'}?${qs}` : pathname || '/dashboard', { scroll: false });
        }, 150);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [embedded, autoFocusSearch, pathname, router, searchParams]);

    // Listen for custom events to coordinate details panel
    useEffect(() => {
        const handleOpenDetails = (e: CustomEvent<ShippedOrder>) => {
            const payload = getOpenShippedDetailsPayload(e.detail);
            if (payload?.order) setSelectedShipped(payload.order);
        };
        const handleCloseDetails = () => {
            setSelectedShipped(null);
        };

        window.addEventListener('open-shipped-details' as any, handleOpenDetails as any);
        window.addEventListener('close-shipped-details' as any, handleCloseDetails as any);
        
        return () => {
            window.removeEventListener('open-shipped-details' as any, handleOpenDetails as any);
            window.removeEventListener('close-shipped-details' as any, handleCloseDetails as any);
        };
    }, []);

    useEffect(() => {
        const handleNavigateDetails = (e: CustomEvent<{ direction?: 'up' | 'down' }>) => {
            if (!selectedShipped || results.length === 0) return;

            const currentIndex = results.findIndex((record) => Number(record.id) === Number(selectedShipped.id));
            if (currentIndex < 0) return;

            const step = e.detail?.direction === 'up' ? -1 : 1;
            const nextRecord = results[currentIndex + step];
            if (!nextRecord) return;

            setSelectedShipped(nextRecord);
            dispatchOpenShippedDetails(nextRecord, 'shipped');
        };

        window.addEventListener('navigate-shipped-details' as any, handleNavigateDetails as any);
        return () => {
            window.removeEventListener('navigate-shipped-details' as any, handleNavigateDetails as any);
        };
    }, [results, selectedShipped]);

    const openDetails = (result: ShippedOrder) => {
        if (selectedShipped && Number(selectedShipped.id) === Number(result.id)) {
            dispatchCloseShippedDetails();
            setSelectedShipped(null);
            return;
        }

        dispatchOpenShippedDetails(result, 'shipped');
        setSelectedShipped(result);
    };

    const handleCopyAll = (e: React.MouseEvent, result: ShippedOrder) => {
        e.stopPropagation();
        
        const text = `Serial: ${result.serial_number || 'N/A'}
Order ID: ${result.order_id || 'N/A'}
Tracking: ${result.shipping_tracking_number || 'N/A'}
Product: ${result.product_title || 'N/A'}
Condition: ${result.condition || 'N/A'}
Tested By: ${getStaffName(result.tested_by)}
Packed By: ${getStaffName(result.packed_by)}
Shipped: ${result.packed_at ? formatDateTimePST(result.packed_at) : 'Not Shipped'}`;
        
        navigator.clipboard.writeText(text);
        setCopiedId(result.id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    // Load search history from localStorage
    useEffect(() => {
        const saved = localStorage.getItem(searchHistoryStorageKey);
        if (saved) {
            const parsed = JSON.parse(saved);
            setSearchHistory(parsed.map((item: any) => ({
                ...item,
                timestamp: new Date(item.timestamp)
            })));
        }
    }, [searchHistoryStorageKey]);

    const clearSearchHistory = () => {
        setSearchHistory([]);
        setShowAllSearchHistory(false);
        localStorage.removeItem(searchHistoryStorageKey);
    };

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.05,
                delayChildren: 0.05,
            },
        },
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

    const visibleSearchHistory = showAllSearchHistory ? searchHistory : searchHistory.slice(0, 3);

    const panelContent = showIntakeForm ? (
        <ShippedIntakeForm
            onClose={onCloseForm || (() => {})}
            onSubmit={onFormSubmit || (() => {})}
        />
    ) : (
        <SidebarShell
            as={motion.div}
            containerProps={{ initial: 'hidden', animate: 'visible', variants: containerVariants }}
            headerAbove={
                <>
                    {filterControl ? <motion.div variants={itemVariants} className="relative z-20">{filterControl}</motion.div> : null}
                    {!hideSectionHeader ? (
                        <motion.header variants={itemVariants} className={`${SIDEBAR_GUTTER} ${filterControl ? 'pt-2' : 'pt-6'}`}>
                            <h2 className="text-xl font-black tracking-tighter uppercase leading-none text-text-default">
                                Shipped Orders
                            </h2>
                            <p className={`${microBadge} text-blue-600 mt-1`}>
                                Search Database
                            </p>
                        </motion.header>
                    ) : null}
                </>
            }
            search={{
                value: inputValue,
                onChange: setInputValue,
                placeholder: getShippedSearchPlaceholder(shippedSearchField),
                isSearching,
                variant: 'blue',
                autoFocus: Boolean(embedded && autoFocusSearch),
                rightElement: (
                    <HoverTooltip label="New Order Entry" asChild>
                        <IconButton
                            onClick={() => {
                                const params = new URLSearchParams(searchParams.toString());
                                params.set('new', 'true');
                                const nextSearch = params.toString();
                                router.replace(nextSearch ? `${pathname || '/dashboard'}?${nextSearch}` : pathname || '/dashboard');
                            }}
                            className="rounded-xl bg-emerald-500 p-2.5 transition-colors hover:bg-emerald-600 disabled:bg-surface-strong"
                            ariaLabel="Open new order entry form"
                            icon={<Plus className="h-5 w-5 text-white" />}
                        />
                    </HoverTooltip>
                ),
            }}
            // Filters bar stays pinned at the top of the sidebar (above the body).
            filter={{
                label: 'Filters',
                refinements,
                onClearAll: clearAll,
                renderDropdown: (onClose) => (
                    <ShippedFilterDropdown
                        onClose={onClose}
                        searchField={shippedSearchField}
                        onSearchFieldChange={onShippedSearchFieldChange}
                    />
                ),
            }}
            // Status legend (dot color → meaning) + live counts — pinned here so
            // it explains the shipped table's outbound status dots.
            headerBelow={
                <div className={`${SIDEBAR_GUTTER} space-y-1.5 pb-1`}>
                    {/* Saved views moved to the table ⋮ menu (station-table-unification §3.2). */}
                    <span className="text-micro font-semibold uppercase tracking-wide text-text-faint">Click a dot to filter</span>
                    <OutboundStatusLegend />
                </div>
            }
            bodyClassName="flex flex-col space-y-4 scrollbar-hide pb-6"
        >
                <motion.div variants={itemVariants} className="space-y-4">
                        {/* Combined Zoho sync + daily pickup report (tabbed) */}
                        <ShippedActionsButton />
                        <div className="space-y-3 border-t border-border-hairline pt-3">
                            <FirstScanOnboardingCard variant="sidebar" />
                            <ThroughputRoiCard variant="sidebar" />
                        </div>

                        {/* AI quick-jump — cross-entity hybrid hits for the same
                            query (renders nothing when the flag is off or empty) */}
                        {aiQuickJump.hits.length > 0 && (
                            <AiQuickJumpResults
                                hits={aiQuickJump.hits}
                                className="rounded-xl border border-border-hairline bg-surface-card"
                            />
                        )}

                        {/* Search Results */}
                        {results.length > 0 && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <p className={`${microBadge} text-text-soft`}>
                                        {results.length} Result{results.length !== 1 ? 's' : ''}
                                    </p>
                                    {/* ds-raw-button: inline text link (microBadge + hover:underline, no chrome) — Button would add height/padding */}
                                    <button
                                        onClick={() => setInputValue('')}
                                        className={`${microBadge} text-blue-600 hover:underline`}
                                    >
                                        Clear
                                    </button>
                                </div>
                                
                                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin">
                                    {results.map((result) => (
                                        <div key={result.id} className="relative group/card">
                                            {/* ds-raw-button: multi-line text-left master-detail result row (order id + product + tracking) — not a Button shape */}
                                            <button
                                                onClick={() => openDetails(result)}
                                                className="w-full text-left p-3 bg-surface-canvas border border-border-soft rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-all group"
                                            >
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-center justify-between">
                                                        <span className={`${sectionLabel} text-text-default group-hover:text-blue-600 truncate pr-8`}>
                                                            {result.order_id}
                                                        </span>
                                                        <span className={`${microBadge} px-1.5 py-0.5 rounded ${result.is_shipped ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                                            {result.is_shipped ? 'Shipped' : 'Pending'}
                                                        </span>
                                                    </div>
                                                    <p className="text-eyebrow text-text-soft font-semibold truncate">{result.product_title}</p>
                                                    <p className={`${microBadge} font-mono text-text-soft truncate`}>{result.shipping_tracking_number}</p>
                                                </div>
                                            </button>
                                            
                                            {/* Copy All Button - Top Left of the card area */}
                                            <HoverTooltip label="Copy all details" asChild>
                                                <IconButton
                                                    tone="accent"
                                                    onClick={(e) => handleCopyAll(e, result)}
                                                    className={`absolute top-2 left-2 p-1.5 rounded-lg border transition-all z-10 ${
                                                        copiedId === result.id
                                                            ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                                                            : 'bg-surface-card border-border-hairline text-text-faint hover:text-blue-600 hover:border-blue-200 opacity-0 group-hover/card:opacity-100 shadow-sm'
                                                    }`}
                                                    ariaLabel="Copy all details"
                                                    icon={copiedId === result.id ? (
                                                        <Check className="w-3 h-3 text-emerald-600" />
                                                    ) : (
                                                        <Copy className="w-3 h-3" />
                                                    )}
                                                />
                                            </HoverTooltip>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {hasSearched && !isSearching && results.length === 0 && (
                            <div className="bg-blue-50 border border-blue-100 rounded-xl p-6 text-center animate-in fade-in slide-in-from-top-2 duration-300">
                                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                    <Search className="w-6 h-6 text-blue-600" />
                                </div>
                                <h3 className="text-sm font-black text-blue-900 uppercase tracking-tight mb-1">No matching shipped records</h3>
                                <p className={`${sectionLabel} text-blue-700 leading-relaxed`}>
                                    No shipped records matched "{trimmedQuery}". Try searching all fields or checking the tracking number.
                                </p>
                                <div className="mt-4 flex items-center justify-center gap-3">
                                    {shippedSearchField !== 'all' && onShippedSearchFieldChange ? (
                                        <Button
                                            variant="primary"
                                            size="md"
                                            onClick={() => {
                                                onShippedSearchFieldChange('all');
                                            }}
                                        >
                                            Change To All
                                        </Button>
                                    ) : null}
                                    <Button
                                        variant="secondary"
                                        size="md"
                                        onClick={() => setInputValue('')}
                                        className="border border-blue-200 bg-surface-card text-blue-700 hover:border-blue-300 hover:bg-blue-100"
                                    >
                                        Clear Search
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* Recent Searches - Only show when no active results */}
                        {searchHistory.length > 0 && results.length === 0 && (
                            <RecentSearchesList
                                items={visibleSearchHistory}
                                totalCount={searchHistory.length}
                                expanded={showAllSearchHistory}
                                onToggleExpanded={() => setShowAllSearchHistory((current) => !current)}
                                onClear={clearSearchHistory}
                                onSelect={(query) => setInputValue(query)}
                                getDisplayQuery={(item) =>
                                    item.query.match(/^\d+$/) && item.query.length > 8
                                        ? item.query.slice(-8)
                                        : item.query
                                }
                                getMetaLabel={(item) =>
                                    typeof item.resultCount === 'number'
                                        ? `${item.resultCount} result${item.resultCount !== 1 ? 's' : ''}`
                                        : 'Reuse'
                                }
                            />
                        )}
                    </motion.div>
        </SidebarShell>
    );

    const sidebarShell = embedded ? (
        panelContent
    ) : (
        <aside className="bg-surface-card text-text-default flex-shrink-0 h-full overflow-hidden border-r border-border-soft relative group w-[300px]">
            {panelContent}
        </aside>
    );

    return (
        <div className={`relative z-40 h-full ${embedded ? '' : 'flex-shrink-0'}`}>
            {sidebarShell}

            {/* Details Panel Overlay - Reused Instance coordinated by shared state/events */}
            <AnimatePresence>
                {showDetailsPanel && selectedShipped && (
                    <ShippedDetailsPanel 
                        key="shipped-details-panel-shared-instance"
                        shipped={selectedShipped}
                        context="shipped"
                        onClose={() => {
                            setSelectedShipped(null);
                            window.dispatchEvent(new CustomEvent('close-shipped-details'));
                        }}
                        onUpdate={() => searchResult.refetch()}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
