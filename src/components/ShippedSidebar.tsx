'use client';

import { ReactNode, useState, useEffect, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, ChevronLeft, ChevronRight, Copy, Check, AlertTriangle, Plus } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';
import { ShippedIntakeForm, type ShippedFormData } from './shipped';
import { ShippedDetailsPanel } from './shipped/ShippedDetailsPanel';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { SearchBar } from './ui/SearchBar';
import { TabSwitch } from './ui/TabSwitch';
import { HorizontalButtonSlider } from './ui/HorizontalButtonSlider';
import { useLast8TrackingSearch } from '@/hooks/useLast8TrackingSearch';
import { formatDateTimePST } from '@/utils/date';
import { dispatchCloseShippedDetails, dispatchOpenShippedDetails, getOpenShippedDetailsPayload } from '@/utils/events';
import { RecentSearchesList } from '@/components/sidebar/RecentSearchesList';
import { getStaffName } from '@/utils/staff';
import { sectionLabel, microBadge } from '@/design-system/tokens/typography/presets';
import {
    getShippedSearchHelperText,
    getShippedSearchPlaceholder,
    SHIPPED_SEARCH_FIELD_OPTIONS,
    type ShippedSearchField,
} from '@/lib/shipped-search';

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
}


function toShippedOrder(order: any): ShippedOrder {
    const primaryTracking = order.shipping_tracking_number || order.tracking_number || null;
    return {
        ...order,
        packed_at: order.packed_at || null,
        packed_by: order.packed_by ?? null,
        tested_by: order.tested_by ?? null,
        serial_number: order.serial_number || '',
        condition: order.condition || '',
        shipping_tracking_number: primaryTracking,
    };
}

const SHIPPED_FILTER_TABS: { id: ShippedTypeFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'orders', label: 'Orders' },
    { id: 'sku', label: 'SKU' },
    { id: 'fba', label: 'FBA' },
];

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
}: ShippedSidebarProps) {
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [searchQuery, setSearchQuery] = useState('');
    const [results, setResults] = useState<ShippedOrder[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
    const [showAllSearchHistory, setShowAllSearchHistory] = useState(false);
    const [selectedShipped, setSelectedShipped] = useState<ShippedOrder | null>(null);
    const [copiedId, setCopiedId] = useState<number | null>(null);
    const { normalizeTrackingQuery } = useLast8TrackingSearch();
    const searchHistoryStorageKey = embedded && hideSectionHeader ? 'dashboard_search_history' : 'shipped_search_history';

    useEffect(() => {
        setSearchQuery(searchValue);
        if (!String(searchValue || '').trim()) {
            setResults([]);
            setHasSearched(false);
        }
    }, [searchValue]);

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

    // Save search history to localStorage
    const saveSearchHistory = (query: string, resultCount: number) => {
        const newHistory = [
            { query, timestamp: new Date(), resultCount },
            ...searchHistory.filter(h => h.query !== query).slice(0, 4)
        ];
        setSearchHistory(newHistory);
        localStorage.setItem(searchHistoryStorageKey, JSON.stringify(newHistory));
    };

    // Handle search
    const handleSearch = useCallback(async (query: string) => {
        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
            setResults([]);
            setHasSearched(false);
            await onSearchChange?.('');
            return;
        }

        const normalizedQuery = normalizeTrackingQuery(trimmedQuery);
        setIsSearching(true);
        setHasSearched(true);
        try {
            const runSearch = async (value: string) => {
                const params = new URLSearchParams({ q: value });
                if (shippedFilter !== 'all') params.set('shippedFilter', shippedFilter);
                if (shippedSearchField !== 'all') params.set('searchField', shippedSearchField);
                const res = await fetch(`/api/shipped?${params.toString()}`);
                if (!res.ok) {
                    const data = await res.json().catch(() => null);
                    throw new Error(data?.details || data?.error || 'Failed to search shipped orders');
                }
                const data = await res.json();
                const orders = Array.isArray(data?.results)
                    ? data.results
                    : Array.isArray(data?.shipped)
                        ? data.shipped
                        : [];
                return orders.map(toShippedOrder);
            };

            let records = await runSearch(trimmedQuery);

            // Fallback for tracking searches: retry with normalized last-8 if no results.
            if (records.length === 0 && normalizedQuery !== trimmedQuery) {
                records = await runSearch(normalizedQuery);
            }
            
            setResults(records);
            saveSearchHistory(trimmedQuery, records.length);
            await onSearchChange?.(trimmedQuery);

            if (records.length === 1) {
                if (pathname === '/dashboard') {
                    window.dispatchEvent(new CustomEvent('close-shipped-details'));
                } else {
                    openDetails(records[0]);
                }
            }
        } catch (error) {
            console.error('Search error:', error);
            setResults([]);
            await onSearchChange?.(trimmedQuery);
        } finally {
            setIsSearching(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname, normalizeTrackingQuery, onSearchChange, shippedFilter, shippedSearchField]);

    const handleInputChange = useCallback((value: string) => {
        setSearchQuery(value);
        void handleSearch(value);
    }, [handleSearch]);

    useEffect(() => {
        if (!searchQuery.trim() || !hasSearched) return;
        void handleSearch(searchQuery);
    }, [handleSearch, hasSearched, searchQuery, shippedFilter, shippedSearchField]);

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
        <motion.div initial="hidden" animate="visible" variants={containerVariants} className="h-full flex flex-col overflow-hidden">
            {filterControl ? <motion.div variants={itemVariants} className="relative z-20">{filterControl}</motion.div> : null}
            <div className={`h-full flex flex-col space-y-4 overflow-y-auto scrollbar-hide px-6 pb-6 ${filterControl ? 'pt-4' : 'pt-6'}`}>
                    {!hideSectionHeader ? (
                        <motion.header variants={itemVariants}>
                            <h2 className="text-xl font-black tracking-tighter uppercase leading-none text-gray-900">
                                Shipped Orders
                            </h2>
                            <p className={`${microBadge} text-blue-600 mt-1`}>
                                Search Database
                            </p>
                        </motion.header>
                    ) : null}

                    <motion.div variants={itemVariants} className="space-y-4">
                        {/* Search Bar */}
                        <SearchBar
                            value={searchQuery}
                            onChange={handleInputChange}
                            placeholder={getShippedSearchPlaceholder(shippedSearchField)}
                            isSearching={isSearching}
                            variant="blue"
                            rightElement={
                                <button
                                    type="button"
                                    onClick={() => {
                                        const params = new URLSearchParams(searchParams.toString());
                                        params.set('new', 'true');
                                        const nextSearch = params.toString();
                                        router.replace(nextSearch ? `${pathname || '/dashboard'}?${nextSearch}` : pathname || '/dashboard');
                                    }}
                                    className="rounded-xl bg-emerald-500 p-2.5 text-white transition-colors hover:bg-emerald-600 disabled:bg-gray-300"
                                    title="New Order Entry"
                                    aria-label="Open new order entry form"
                                >
                                    <Plus className="h-5 w-5" />
                                </button>
                            }
                        />

                        {/* Type filter — canonical TabSwitch (see design system) */}
                        {onShippedFilterChange && (
                            <TabSwitch
                                tabs={SHIPPED_FILTER_TABS}
                                activeTab={shippedFilter}
                                onTabChange={(id) => onShippedFilterChange(id as ShippedTypeFilter)}
                            />
                        )}

                        {onShippedSearchFieldChange && (
                            <HorizontalButtonSlider
                                items={SHIPPED_SEARCH_FIELD_OPTIONS.map((option) => ({
                                    id: option.id,
                                    label: option.label,
                                }))}
                                value={shippedSearchField}
                                onChange={(id) => onShippedSearchFieldChange(id as ShippedSearchField)}
                                variant="slate"
                                size="md"
                                aria-label="Shipped search field"
                            />
                        )}

                        <p className={`${microBadge} text-gray-500 px-1`}>
                            {getShippedSearchHelperText(shippedSearchField)}
                        </p>

                        {/* Search Results */}
                        {results.length > 0 && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <p className={`${microBadge} text-gray-500`}>
                                        {results.length} Result{results.length !== 1 ? 's' : ''}
                                    </p>
                                    <button
                                        onClick={() => {
                                            setResults([]);
                                            setHasSearched(false);
                                        }}
                                        className={`${microBadge} text-blue-600 hover:underline`}
                                    >
                                        Clear
                                    </button>
                                </div>
                                
                                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin">
                                    {results.map((result) => (
                                        <div key={result.id} className="relative group/card">
                                            <button
                                                onClick={() => openDetails(result)}
                                                className="w-full text-left p-3 bg-gray-50 border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-all group"
                                            >
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-center justify-between">
                                                        <span className={`${sectionLabel} text-gray-900 group-hover:text-blue-600 truncate pr-8`}>
                                                            {result.order_id}
                                                        </span>
                                                        <span className={`${microBadge} px-1.5 py-0.5 rounded ${result.is_shipped ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                                            {result.is_shipped ? 'Shipped' : 'Pending'}
                                                        </span>
                                                    </div>
                                                    <p className="text-[9px] text-gray-500 font-semibold truncate">{result.product_title}</p>
                                                    <p className={`${microBadge} font-mono text-gray-500 truncate`}>{result.shipping_tracking_number}</p>
                                                </div>
                                            </button>
                                            
                                            {/* Copy All Button - Top Left of the card area */}
                                            <button
                                                onClick={(e) => handleCopyAll(e, result)}
                                                className={`absolute top-2 left-2 p-1.5 rounded-lg border transition-all z-10 ${
                                                    copiedId === result.id
                                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                                                        : 'bg-white border-gray-100 text-gray-400 hover:text-blue-600 hover:border-blue-200 opacity-0 group-hover/card:opacity-100 shadow-sm'
                                                }`}
                                                title="Copy all details"
                                            >
                                                {copiedId === result.id ? (
                                                    <Check className="w-3 h-3" />
                                                ) : (
                                                    <Copy className="w-3 h-3" />
                                                )}
                                            </button>
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
                                    No shipped records matched "{searchQuery}". Try searching all fields or checking the tracking number.
                                </p>
                                <div className="mt-4 flex items-center justify-center gap-3">
                                    {shippedSearchField !== 'all' && onShippedSearchFieldChange ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onShippedSearchFieldChange('all');
                                            }}
                                            className={`rounded-xl bg-blue-600 px-4 py-2 text-white ${sectionLabel} shadow-sm transition-colors hover:bg-blue-700`}
                                        >
                                            Change To All
                                        </button>
                                    ) : null}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSearchQuery('');
                                            setResults([]);
                                            setHasSearched(false);
                                            void onSearchChange?.('');
                                        }}
                                        className={`rounded-xl border border-blue-200 bg-white px-4 py-2 text-blue-700 ${sectionLabel} transition-colors hover:border-blue-300 hover:bg-blue-100`}
                                    >
                                        Clear Search
                                    </button>
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
                                onSelect={(query) => {
                                    setSearchQuery(query);
                                    handleSearch(query);
                                }}
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

                    <motion.footer variants={itemVariants} className="mt-auto pt-4 border-t border-gray-200 opacity-30 text-center">
                        <p className="text-[7px] font-mono uppercase tracking-[0.2em] text-gray-500">USAV SHIPPED</p>
                    </motion.footer>
            </div>
        </motion.div>
    );

    const sidebarShell = embedded ? (
        panelContent
    ) : (
        <aside className="bg-white text-gray-900 flex-shrink-0 h-full overflow-hidden border-r border-gray-200 relative group w-[300px]">
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
                        onUpdate={() => handleSearch(searchQuery)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
