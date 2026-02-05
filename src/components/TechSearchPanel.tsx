'use client';

import { useState } from 'react';
import { Search, Loader2, Package, Copy, Check } from './Icons';
import { SearchBar } from './ui/SearchBar';

interface SearchResult {
    id: number;
    shipped_date: string | null;
    tracking_number: string;
    customer: string;
    product: string;
    order_id: string;
    serial_number: string;
    notes: string;
    is_shipped: boolean;
}

export default function TechSearchPanel() {
    const [searchQuery, setSearchQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [copiedField, setCopiedField] = useState<string | null>(null);

    const handleSearch = async () => {
        if (!searchQuery.trim()) {
            setResults([]);
            return;
        }

        setIsSearching(true);
        try {
            const res = await fetch(`/api/shipped/search?q=${encodeURIComponent(searchQuery)}`);
            const data = await res.json();
            
            if (data.results) {
                setResults(data.results);
            }
        } catch (error) {
            console.error('Search error:', error);
            setResults([]);
        } finally {
            setIsSearching(false);
        }
    };

    const copyToClipboard = (text: string, field: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
    };

    return (
        <div className="flex flex-col h-full bg-white border-r border-gray-200">
            {/* Search Section */}
            <div className="p-4 border-b border-gray-200">
                <div className="flex items-center gap-2 mb-3">
                    <Search className="w-5 h-5 text-blue-600" />
                    <h3 className="text-sm font-black uppercase tracking-tight text-gray-900">
                        Order Lookup
                    </h3>
                </div>

                <div className="space-y-2">
                    <SearchBar
                        value={searchQuery}
                        onChange={setSearchQuery}
                        onSearch={handleSearch}
                        placeholder="Tracking, Order ID, Serial..."
                        isSearching={isSearching}
                        variant="blue"
                        rightElement={
                            <button
                                onClick={handleSearch}
                                disabled={isSearching || !searchQuery.trim()}
                                className="p-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 text-white disabled:text-gray-400 rounded-xl transition-all active:scale-95 shadow-lg shadow-blue-600/10 disabled:cursor-not-allowed"
                                title="Search Neon DB"
                            >
                                {isSearching ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Search className="w-4 h-4" />
                                )}
                            </button>
                        }
                    />
                </div>
            </div>

            {/* Results Section */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {results.length > 0 && (
                    <>
                        <p className="text-[8px] font-bold text-gray-500 uppercase tracking-widest">
                            {results.length} Result{results.length !== 1 ? 's' : ''} Found
                        </p>
                        
                        {results.map((result) => (
                            <div
                                key={result.id}
                                className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3 hover:border-blue-300 transition-all"
                            >
                                {/* Status Badge */}
                                <div className="flex items-center justify-between">
                                    <span className={`px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest ${
                                        result.is_shipped 
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : 'bg-amber-100 text-amber-700'
                                    }`}>
                                        {result.is_shipped ? '✓ Shipped' : '○ Pending'}
                                    </span>
                                </div>

                                {/* Serial Number */}
                                {result.serial_number && (
                                    <div className="bg-emerald-600 text-white p-3 rounded-lg">
                                        <div className="flex items-center justify-between">
                                            <div className="flex-1">
                                                <p className="text-[8px] font-bold uppercase tracking-widest opacity-80 mb-1">
                                                    Serial Number
                                                </p>
                                                <p className="text-sm font-black font-mono">
                                                    {result.serial_number}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => copyToClipboard(result.serial_number, `serial-${result.id}`)}
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
                                )}

                                {/* Product Info */}
                                <div className="space-y-2 text-[10px]">
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="text-gray-500 font-bold uppercase tracking-wider text-[8px]">Product</span>
                                        <span className="font-semibold text-right flex-1">{result.customer}</span>
                                    </div>

                                    <div className="flex items-start justify-between gap-2">
                                        <span className="text-gray-500 font-bold uppercase tracking-wider text-[8px]">Condition</span>
                                        <span className="font-semibold text-right flex-1">{result.product}</span>
                                    </div>

                                    <div className="pt-2 border-t border-gray-200 flex items-center justify-between gap-2">
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
                                </div>
                            </div>
                        ))}
                    </>
                )}

                {results.length === 0 && searchQuery && !isSearching && (
                    <div className="flex flex-col items-center justify-center py-12 text-center opacity-40">
                        <Package className="w-12 h-12 mb-3 text-gray-300" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                            No Results Found
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
