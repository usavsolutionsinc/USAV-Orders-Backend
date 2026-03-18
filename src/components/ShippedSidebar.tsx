'use client';

import { ReactNode, useState, useEffect, useCallback, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, ChevronLeft, ChevronRight, Copy, Check, AlertTriangle, Plus } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';
import { ShippedIntakeForm, type ShippedFormData } from './shipped';
import { ShippedDetailsPanel } from './shipped/ShippedDetailsPanel';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { SearchBar } from './ui/SearchBar';
import { useLast8TrackingSearch } from '@/hooks/useLast8TrackingSearch';
import { formatDateTimePST } from '@/utils/date';
import { dispatchCloseShippedDetails } from '@/utils/events';
import { RecentSearchesList } from '@/components/sidebar/RecentSearchesList';
import { isFbaOrder } from '@/utils/order-platform';

interface SearchHistory {
    query: string;
    timestamp: Date;
    resultCount?: number;
}

interface ShippedSidebarProps {
    showIntakeForm?: boolean;
    onCloseForm?: () => void;
    onFormSubmit?: (data: ShippedFormData) => void;
    filterControl?: ReactNode;
    showDetailsPanel?: boolean;
    embedded?: boolean;
    hideSectionHeader?: boolean;
}

// Hard-coded staff ID to name mapping
const STAFF_NAMES: { [key: number]: string } = {
    1: 'Michael',
    2: 'Thuc',
    3: 'Sang',
    4: 'Tuan',
    5: 'Thuy',
    6: 'Cuong'
};

function getStaffName(staffId: number | null | undefined): string {
    if (!staffId) return 'N/A';
    return STAFF_NAMES[staffId] || `Staff #${staffId}`;
}

function toShippedOrder(order: any): ShippedOrder {
    return {
        ...order,
        packed_at: order.packed_at || null,
        packed_by: order.packed_by ?? null,
        tested_by: order.tested_by ?? null,
        serial_number: order.serial_number || '',
        condition: order.condition || '',
    };
}

export default function ShippedSidebar({
    showIntakeForm = false,
    onCloseForm,
    onFormSubmit,
    filterControl,
    showDetailsPanel = true,
    embedded = false,
    hideSectionHeader = false,
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
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Listen for custom events to coordinate details panel
    useEffect(() => {
        const handleOpenDetails = (e: CustomEvent<ShippedOrder>) => {
            if (e.detail) {
                setSelectedShipped(e.detail);
            }
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
            window.dispatchEvent(new CustomEvent('open-shipped-details', { detail: nextRecord }));
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

        // Use custom event to coordinate single instance behavior
        const event = new CustomEvent('open-shipped-details', { detail: result });
        window.dispatchEvent(event);
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
            return;
        }

        const normalizedQuery = normalizeTrackingQuery(trimmedQuery);
        setIsSearching(true);
        setHasSearched(true);
        try {
            const runSearch = async (value: string) => {
                const params = new URLSearchParams({ q: value });
                const res = await fetch(`/api/shipped?${params.toString()}`);
                const data = await res.json();
                const orders = Array.isArray(data?.results)
                    ? data.results
                    : Array.isArray(data?.shipped)
                        ? data.shipped
                        : [];
                return orders
                    .map(toShippedOrder)
                    .filter((record: ShippedOrder) => !isFbaOrder(record.order_id, record.account_source));
            };

            let records = await runSearch(trimmedQuery);

            // Fallback for tracking searches: retry with normalized last-8 if no results.
            if (records.length === 0 && normalizedQuery !== trimmedQuery) {
                records = await runSearch(normalizedQuery);
            }
            
            setResults(records);
            saveSearchHistory(trimmedQuery, records.length);

            if (pathname === '/dashboard') {
                const params = new URLSearchParams(searchParams.toString());
                params.delete('pending');
                params.delete('unshipped');
                params.delete('fba');
                params.set('shipped', '');
                params.set('search', trimmedQuery);
                if (records.length === 1) params.set('openOrderId', String(records[0].id));
                else params.delete('openOrderId');
                const nextSearch = params.toString();
                router.replace(nextSearch ? `/dashboard?${nextSearch}` : '/dashboard');
            }

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
        } finally {
            setIsSearching(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname, searchParams, router, normalizeTrackingQuery]);

    const handleInputChange = useCallback((value: string) => {
        setSearchQuery(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            handleSearch(value);
        }, 400);
    }, [handleSearch]);

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
                            <p className="text-[9px] font-bold text-blue-600 uppercase tracking-widest mt-1">
                                Search Database
                            </p>
                        </motion.header>
                    ) : null}

                    <motion.div variants={itemVariants} className="space-y-4">
                        {/* Search Bar */}
                        <SearchBar
                            value={searchQuery}
                            onChange={handleInputChange}
                            onSearch={handleSearch}
                            placeholder="Order ID, Tracking, or Serial..."
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
                                    className="p-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl transition-all active:scale-95 shadow-lg shadow-emerald-500/20"
                                    title="New Order Entry"
                                    aria-label="Open new order entry form"
                                >
                                    <Plus className="w-4 h-4" />
                                </button>
                            }
                        />
                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest px-1">
                            Click a Shipped Row for More Details
                        </p>

                        {/* Search Results */}
                        {results.length > 0 && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">
                                        {results.length} Result{results.length !== 1 ? 's' : ''}
                                    </p>
                                    <button 
                                        onClick={() => {
                                            setResults([]);
                                            setHasSearched(false);
                                        }}
                                        className="text-[9px] font-bold text-blue-600 uppercase hover:underline"
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
                                                        <span className="text-[10px] font-black text-gray-900 group-hover:text-blue-600 truncate pr-8">
                                                            {result.order_id}
                                                        </span>
                                                        <span className={`text-[7px] font-black px-1.5 py-0.5 rounded uppercase ${result.is_shipped ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                                            {result.is_shipped ? 'Shipped' : 'Pending'}
                                                        </span>
                                                    </div>
                                                    <p className="text-[9px] text-gray-500 font-medium truncate">{result.product_title}</p>
                                                    <p className="text-[8px] font-mono text-gray-400 truncate">{result.shipping_tracking_number}</p>
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
                            <div className="bg-red-50 border border-red-100 rounded-xl p-6 text-center animate-in fade-in slide-in-from-top-2 duration-300">
                                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                    <Search className="w-6 h-6 text-red-600" />
                                </div>
                                <h3 className="text-sm font-black text-red-900 uppercase tracking-tight mb-1">Order not found</h3>
                                <p className="text-[10px] text-red-600 font-bold uppercase tracking-widest leading-relaxed">
                                    We couldn't find any records matching "{searchQuery}"
                                </p>
                                <button 
                                    onClick={() => {
                                        setSearchQuery('');
                                        setHasSearched(false);
                                    }}
                                    className="mt-4 text-[10px] font-black text-red-700 uppercase tracking-widest hover:underline"
                                >
                                    Clear search
                                </button>
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
