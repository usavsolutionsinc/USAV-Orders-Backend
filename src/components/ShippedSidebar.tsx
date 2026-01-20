'use client';

import { useState, useEffect } from 'react';
import { Search, ChevronLeft, ChevronRight, Copy, Check, AlertTriangle } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';

interface SearchResult {
    id: number;
    shipped_date: string | null;
    order_id: string;
    customer: string;
    product: string;
    tracking_number: string;
    serial_number: string;
    notes: string;
    is_shipped: boolean;
    date_time?: string;
}

interface SearchHistory {
    query: string;
    timestamp: Date;
    resultCount: number;
}

export default function ShippedSidebar() {
    const [isOpen, setIsOpen] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
    const [copiedField, setCopiedField] = useState<string | null>(null);

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

        setIsSearching(true);
        setHasSearched(true);
        try {
            const res = await fetch(`/api/shipped/search?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            
            if (data.results) {
                setResults(data.results);
                saveSearchHistory(query, data.count);
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

    // Handle enter key
    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSearch(searchQuery);
        }
    };

    // Copy to clipboard
    const copyToClipboard = (text: string, field: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
    };

    // Copy entire row
    const copyRow = (result: SearchResult) => {
        const rowText = `Order ID: ${result.order_id}\nTracking: ${result.tracking_number}\nSerial: ${result.serial_number || 'N/A'}\nCondition: ${result.product}\nProduct: ${result.customer}\nShipped: ${result.is_shipped ? result.shipped_date : 'Not Shipped'}`;
        copyToClipboard(rowText, `row-${result.id}`);
    };

    return (
        <div className="relative flex-shrink-0 z-40 h-full">
            <AnimatePresence mode="wait">
                {isOpen && (
                    <motion.aside
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 380, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ type: "spring", damping: 25, stiffness: 120 }}
                        className="bg-white text-gray-900 flex-shrink-0 h-full overflow-hidden border-r border-gray-200 relative group"
                    >
                        <button
                            onClick={() => setIsOpen(false)}
                            className="absolute top-4 right-4 z-50 p-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                            title="Collapse Menu"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>

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
                                <div className="relative group">
                                    <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                                        <Search className="w-3.5 h-3.5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Order ID, Tracking, or Serial..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        onKeyPress={handleKeyPress}
                                        className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 text-[11px] font-semibold tracking-wide focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all placeholder:text-gray-400"
                                    />
                                    {isSearching && (
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                        </div>
                                    )}
                                </div>

                                <button
                                    onClick={() => handleSearch(searchQuery)}
                                    disabled={isSearching || !searchQuery.trim()}
                                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 text-white disabled:text-gray-400 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:cursor-not-allowed"
                                >
                                    {isSearching ? 'Searching...' : 'Search'}
                                </button>

                                {/* Search Results */}
                                {results.length > 0 ? (
                                    <div className="space-y-3">
                                        <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">
                                            {results.length} Result{results.length !== 1 ? 's' : ''}
                                        </p>
                                        
                                        <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin">
                                            {results.map((result) => {
                                                const hasAlert = result.date_time === '1';
                                                return (
                                                <div
                                                    key={result.id}
                                                    className={`bg-gray-50 border rounded-xl p-4 space-y-3 transition-all relative group ${
                                                        hasAlert ? 'border-red-500 bg-red-50 ring-2 ring-red-500/20' : 'border-gray-200 hover:border-blue-300'
                                                    }`}
                                                >
                                                    {/* Alert Banner if date_time is 1 */}
                                                    {hasAlert && (
                                                        <div className="bg-red-600 text-white p-2 rounded-lg animate-pulse mb-2">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <AlertTriangle className="w-4 h-4" />
                                                                <span className="text-xs font-black uppercase">URGENT ALERT!</span>
                                                            </div>
                                                        </div>
                                                    )}
                                                    
                                                    {/* Status Badge */}
                                                    <div className="flex items-center justify-between">
                                                        <span className={`px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest ${
                                                            result.is_shipped 
                                                                ? 'bg-emerald-100 text-emerald-700'
                                                                : 'bg-amber-100 text-amber-700'
                                                        }`}>
                                                            {result.is_shipped ? '✓ Shipped' : '○ Not Shipped'}
                                                        </span>
                                                        
                                                        <button
                                                            onClick={() => copyRow(result)}
                                                            className="opacity-0 group-hover:opacity-100 p-1.5 bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all"
                                                            title="Copy entire row"
                                                        >
                                                            {copiedField === `row-${result.id}` ? (
                                                                <Check className="w-3 h-3 text-emerald-600" />
                                                            ) : (
                                                                <Copy className="w-3 h-3 text-gray-500" />
                                                            )}
                                                        </button>
                                                    </div>

                                                    {/* Serial Number - PROMINENT */}
                                                    <div className="bg-blue-600 text-white p-3 rounded-lg">
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex-1">
                                                                <p className="text-[8px] font-bold uppercase tracking-widest opacity-80 mb-1">
                                                                    Serial Number
                                                                </p>
                                                                <p className="text-sm font-black font-mono">
                                                                    {result.serial_number || 'N/A'}
                                                                </p>
                                                            </div>
                                                            <button
                                                                onClick={() => copyToClipboard(result.serial_number || 'N/A', `serial-${result.id}`)}
                                                                className="p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-all"
                                                            >
                                                                {copiedField === `serial-${result.id}` ? (
                                                                    <Check className="w-3 h-3" />
                                                                ) : (
                                                                    <Copy className="w-3 h-3" />
                                                                )}
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Other Details */}
                                                    <div className="space-y-2 text-[10px]">
                                                        {/* Tracking Number (displayed first, but labeled as Order ID per DB mapping) */}
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="text-gray-500 font-bold uppercase tracking-wider text-[8px]">Order ID</span>
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-mono font-semibold">{result.tracking_number}</span>
                                                                <button
                                                                    onClick={() => copyToClipboard(result.tracking_number, `order-${result.id}`)}
                                                                    className="p-1 hover:bg-gray-200 rounded transition-all"
                                                                >
                                                                    {copiedField === `order-${result.id}` ? (
                                                                        <Check className="w-3 h-3 text-emerald-600" />
                                                                    ) : (
                                                                        <Copy className="w-3 h-3 text-gray-400" />
                                                                    )}
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {/* Order ID (displayed second, but labeled as Tracking per DB mapping) */}
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="text-gray-500 font-bold uppercase tracking-wider text-[8px]">Tracking</span>
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-mono font-semibold">{result.order_id}</span>
                                                                <button
                                                                    onClick={() => copyToClipboard(result.order_id, `tracking-${result.id}`)}
                                                                    className="p-1 hover:bg-gray-200 rounded transition-all"
                                                                >
                                                                    {copiedField === `tracking-${result.id}` ? (
                                                                        <Check className="w-3 h-3 text-emerald-600" />
                                                                    ) : (
                                                                        <Copy className="w-3 h-3 text-gray-400" />
                                                                    )}
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {/* Product */}
                                                        <div className="pt-2 border-t border-gray-200">
                                                            <p className="text-gray-500 font-bold uppercase tracking-wider text-[8px] mb-1">Product:</p>
                                                            <p className="font-semibold leading-tight">{result.customer}</p>
                                                        </div>

                                                        {/* Condition */}
                                                        <div className="pt-2 border-t border-gray-200">
                                                            <p className="text-gray-500 font-bold uppercase tracking-wider text-[8px] mb-1">Condition</p>
                                                            <p className="font-semibold leading-tight">{result.product}</p>
                                                        </div>

                                                        {/* Shipped Date */}
                                                        {result.is_shipped && result.shipped_date && (
                                                            <div className="text-[9px] text-gray-500 font-medium">
                                                                Shipped: {result.shipped_date}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                            })}
                                        </div>
                                    </div>
                                ) : hasSearched && !isSearching && (
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

                                {/* Search History */}
                                {searchHistory.length > 0 && results.length === 0 && (
                                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                                        <p className="text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-3">
                                            Recent Searches
                                        </p>
                                        <div className="space-y-2">
                                            {searchHistory.slice(0, 5).map((item, index) => {
                                                // Show last 6 digits for numeric tracking numbers
                                                const displayQuery = item.query.match(/^\d+$/) && item.query.length > 6 
                                                    ? '...' + item.query.slice(-6) 
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
                    </motion.aside>
                )}
            </AnimatePresence>

            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="fixed top-20 left-0 z-[60] p-3 bg-white text-gray-900 rounded-r-2xl shadow-xl hover:bg-blue-600 hover:text-white transition-all duration-300 group border border-l-0 border-gray-200"
                >
                    <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                </button>
            )}
        </div>
    );
}
