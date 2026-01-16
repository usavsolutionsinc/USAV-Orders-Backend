'use client';

import { useState } from 'react';
import { Search, Copy, Check, Loader2 } from './Icons';

interface SearchResult {
    id: string;
    timestamp: string;
    tracking: string;
    status: string;
    count: number;
}

export default function ReceivingSearch() {
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
            const res = await fetch(`/api/receiving-logs/search?q=${encodeURIComponent(searchQuery)}`);
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

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    };

    const copyToClipboard = (text: string, field: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
    };

    return (
        <div className="border-t border-gray-200 p-4 space-y-3">
            <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                Search History
            </div>

            <div className="space-y-2">
                <div className="relative group">
                    <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                        <Search className="w-3 h-3 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    </div>
                    <input
                        type="text"
                        placeholder="Search tracking..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyPress={handleKeyPress}
                        className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2 pl-8 pr-3 text-[10px] font-semibold tracking-wide focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all placeholder:text-gray-400"
                    />
                    {isSearching && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                        </div>
                    )}
                </div>

                <button
                    onClick={handleSearch}
                    disabled={isSearching || !searchQuery.trim()}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 text-white disabled:text-gray-400 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all disabled:cursor-not-allowed"
                >
                    {isSearching ? 'Searching...' : 'Search'}
                </button>
            </div>

            {results.length > 0 && (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    <p className="text-[8px] font-bold text-gray-500 uppercase tracking-widest">
                        {results.length} Result{results.length !== 1 ? 's' : ''}
                    </p>
                    
                    {results.map((result) => (
                        <div
                            key={result.id}
                            className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2 hover:border-blue-300 transition-all"
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-mono font-bold text-blue-600 flex-1 truncate">
                                    {result.tracking}
                                </span>
                                <button
                                    onClick={() => copyToClipboard(result.tracking, `tracking-${result.id}`)}
                                    className="p-1 hover:bg-gray-200 rounded transition-all"
                                >
                                    {copiedField === `tracking-${result.id}` ? (
                                        <Check className="w-3 h-3 text-emerald-600" />
                                    ) : (
                                        <Copy className="w-3 h-3 text-gray-400" />
                                    )}
                                </button>
                            </div>

                            <div className="flex items-center justify-between text-[8px]">
                                <span className="text-gray-500 font-bold uppercase">
                                    {result.status || 'Unknown Carrier'}
                                </span>
                                <span className="text-gray-400 font-medium">
                                    {new Date(result.timestamp).toLocaleDateString()}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
