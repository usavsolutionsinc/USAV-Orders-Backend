'use client';

import { useState, useEffect } from 'react';
import { Search, ChevronLeft, ChevronRight, Copy, Check, AlertTriangle, Plus } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';
import { ShippedIntakeForm, type ShippedFormData } from './shipped';
import { ShippedDetailsPanel } from './shipped/ShippedDetailsPanel';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { SearchBar } from './ui/SearchBar';
import { useLast8TrackingSearch } from '@/hooks/useLast8TrackingSearch';

interface SearchHistory {
    query: string;
    timestamp: Date;
    resultCount: number;
}

interface ShippedSidebarProps {
    showIntakeForm?: boolean;
    onCloseForm?: () => void;
    onFormSubmit?: (data: ShippedFormData) => void;
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

export default function ShippedSidebar({ showIntakeForm = false, onCloseForm, onFormSubmit }: ShippedSidebarProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [results, setResults] = useState<ShippedOrder[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
    const [selectedShipped, setSelectedShipped] = useState<ShippedOrder | null>(null);
    const [copiedId, setCopiedId] = useState<number | null>(null);
    const { normalizeTrackingQuery } = useLast8TrackingSearch();

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

    const openDetails = (result: ShippedOrder) => {
        // Use custom event to coordinate single instance behavior
        const event = new CustomEvent('open-shipped-details', { detail: result });
        window.dispatchEvent(event);
        setSelectedShipped(result);
    };

    const handleCopyAll = (e: React.MouseEvent, result: ShippedOrder) => {
        e.stopPropagation();
        
        const formatDateTime = (dateStr: string) => {
            if (!dateStr || dateStr === '1') return 'N/A';
            try {
                const date = new Date(dateStr);
                return date.toLocaleString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                }).replace(',', '');
            } catch (e) {
                return dateStr;
            }
        };

        const text = `Serial: ${result.serial_number || 'N/A'}
Order ID: ${result.order_id || 'N/A'}
Tracking: ${result.shipping_tracking_number || 'N/A'}
Product: ${result.product_title || 'N/A'}
Condition: ${result.condition || 'N/A'}
Tested By: ${getStaffName(result.tested_by)}
Packed By: ${getStaffName(result.packed_by)}
Shipped: ${result.pack_date_time ? formatDateTime(result.pack_date_time) : 'Not Shipped'}`;
        
        navigator.clipboard.writeText(text);
        setCopiedId(result.id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    // Load search history from localStorage
    useEffect(() => {
        const saved = localStorage.getItem('shipped_search_history');
        if (saved) {
            const parsed = JSON.parse(saved);
            setSearchHistory(parsed.map((item: any) => ({
                ...item,
                timestamp: new Date(item.timestamp)
            })));
        }
    }, []);

    // Save search history to localStorage
    const saveSearchHistory = (query: string, resultCount: number) => {
        const newHistory = [
            { query, timestamp: new Date(), resultCount },
            ...searchHistory.filter(h => h.query !== query).slice(0, 4)
        ];
        setSearchHistory(newHistory);
        localStorage.setItem('shipped_search_history', JSON.stringify(newHistory));
    };

    // Handle search
        const handleSearch = async (query: string) => {
        if (!query.trim()) {
            setResults([]);
            setHasSearched(false);
            return;
        }

        const normalizedQuery = normalizeTrackingQuery(query);
        setIsSearching(true);
        setHasSearched(true);
        try {
            const res = await fetch(`/api/shipped/search?q=${encodeURIComponent(normalizedQuery)}`);
            const data = await res.json();
            
            if (data.results) {
                setResults(data.results);
                saveSearchHistory(query, data.count);
                // If only one result, open it directly using the shared event system
                if (data.results.length === 1) {
                    openDetails(data.results[0]);
                }
            } else {
                setResults([]);
            }
        } catch (error) {
            console.error('Search error:', error);
            setResults([]);
        } finally {
            setIsSearching(false);
        }
    };

    return (
        <div className="relative flex-shrink-0 z-40 h-full">
            <aside
                className="bg-white text-gray-900 flex-shrink-0 h-full overflow-hidden border-r border-gray-200 relative group w-[300px]"
            >
                {showIntakeForm ? (
                    <ShippedIntakeForm 
                        onClose={onCloseForm || (() => {})}
                        onSubmit={onFormSubmit || (() => {})}
                    />
                ) : (
                <div className="p-6 h-full flex flex-col space-y-4 overflow-y-auto scrollbar-hide">
                    <header>
                        <h2 className="text-xl font-black tracking-tighter uppercase leading-none text-gray-900">
                            Shipped Orders
                        </h2>
                        <p className="text-[9px] font-bold text-blue-600 uppercase tracking-widest mt-1">
                            Search Database
                        </p>
                    </header>
                    
                    <div className="space-y-4">
                        {/* Search Bar */}
                        <SearchBar
                            value={searchQuery}
                            onChange={setSearchQuery}
                            onSearch={handleSearch}
                            placeholder="Order ID, Tracking, or Serial..."
                            isSearching={isSearching}
                            variant="blue"
                            rightElement={
                                <button
                                    onClick={() => handleSearch(searchQuery)}
                                    disabled={isSearching || !searchQuery.trim()}
                                    className="p-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 text-white disabled:text-gray-400 rounded-2xl transition-all active:scale-95 shadow-lg shadow-blue-600/10 disabled:cursor-not-allowed"
                                    title="Search"
                                >
                                    {isSearching ? (
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                        <Search className="w-4 h-4" />
                                    )}
                                </button>
                            }
                        />
                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest px-1">
                            Click a Shipped Row for More Details.
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
                            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                                <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-3">
                                    Recent Searches
                                </p>
                                <div className="space-y-2">
                                    {searchHistory.slice(0, 5).map((item, index) => {
                                        const displayQuery = item.query.match(/^\d+$/) && item.query.length > 8 
                                            ? item.query.slice(-8) 
                                            : item.query;
                                        
                                        return (
                                            <button
                                                key={index}
                                                onClick={() => {
                                                    setSearchQuery(item.query);
                                                    handleSearch(item.query);
                                                }}
                                                className="w-full text-left p-2 bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all group"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[10px] font-semibold text-gray-900 group-hover:text-blue-600">
                                                        {displayQuery}
                                                    </span>
                                                    <span className="text-[8px] text-gray-400 font-medium">
                                                        {item.resultCount} result{item.resultCount !== 1 ? 's' : ''}
                                                    </span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    <footer className="mt-auto pt-4 border-t border-gray-200 opacity-30 text-center">
                        <p className="text-[7px] font-mono uppercase tracking-[0.2em] text-gray-500">USAV SHIPPED</p>
                    </footer>
                </div>
                )}
            </aside>

            {/* Details Panel Overlay - Reused Instance coordinated by shared state/events */}
            <AnimatePresence>
                {selectedShipped && (
                    <ShippedDetailsPanel 
                        key="shipped-details-panel-shared-instance"
                        shipped={selectedShipped}
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
