'use client';

import { useState, useEffect } from 'react';
import { Package, AlertTriangle, X, Search, Copy, Check, Loader2 } from './Icons';

interface SearchResult {
    id: string;
    timestamp: string;
    tracking: string;
    status: string;
    count: number;
}

interface ReceivingPanelProps {
    onEntryAdded?: () => void;
}

export default function ReceivingPanel({ onEntryAdded }: ReceivingPanelProps) {
    const [trackingNumber, setTrackingNumber] = useState('');
    const [carrier, setCarrier] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [urgentTracking, setUrgentTracking] = useState<string | null>(null);
    const [showUrgentAlert, setShowUrgentAlert] = useState(false);

    const [searchQuery, setSearchQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [copiedField, setCopiedField] = useState<string | null>(null);

    // Load urgent tracking number from localStorage
    useEffect(() => {
        const urgent = localStorage.getItem('urgentTrackingNumber');
        setUrgentTracking(urgent);
    }, []);

    // Check if entered tracking matches urgent tracking
    useEffect(() => {
        if (trackingNumber && urgentTracking) {
            const matches = trackingNumber.toLowerCase().trim() === urgentTracking.toLowerCase().trim();
            setShowUrgentAlert(matches);
        } else {
            setShowUrgentAlert(false);
        }
    }, [trackingNumber, urgentTracking]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!trackingNumber.trim()) return;

        setIsSubmitting(true);
        try {
            const now = new Date();
            const timestamp = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
            
            const res = await fetch('/api/receiving-entry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trackingNumber,
                    carrier: carrier || 'Unknown',
                    timestamp,
                }),
            });

            if (!res.ok) throw new Error('Failed to add entry');

            setTrackingNumber('');
            setCarrier('');
            setShowUrgentAlert(false);
            
            if (onEntryAdded) onEntryAdded();
        } catch (error) {
            console.error('Error adding entry:', error);
            alert('Failed to add entry');
        } finally {
            setIsSubmitting(false);
        }
    };

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

    const handleSearchKeyPress = (e: React.KeyboardEvent) => {
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
        <div className="flex flex-col h-full bg-white border-r border-gray-200">
            {/* Entry Form at Top */}
            <div className="p-4 border-b border-gray-200">
                {showUrgentAlert && (
                    <div className="mb-3 bg-red-600 text-white p-2 rounded-lg animate-pulse">
                        <div className="flex items-center justify-center gap-2">
                            <AlertTriangle className="w-4 h-4" />
                            <span className="text-xs font-black uppercase">URGENT!</span>
                        </div>
                    </div>
                )}

                <div className="flex items-center gap-2 mb-3">
                    <Package className="w-5 h-5 text-blue-600" />
                    <h3 className="text-sm font-black uppercase tracking-tight text-gray-900">
                        Scan Entry
                    </h3>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                    <div>
                        <input
                            type="text"
                            value={trackingNumber}
                            onChange={(e) => setTrackingNumber(e.target.value)}
                            placeholder="Scan tracking number..."
                            className={`w-full px-3 py-2 bg-gray-50 border rounded-lg text-sm font-semibold outline-none transition-all ${
                                showUrgentAlert 
                                    ? 'border-red-500 ring-2 ring-red-500/20 bg-red-50' 
                                    : 'border-gray-200 focus:ring-2 focus:ring-blue-500'
                            }`}
                            autoFocus
                            required
                        />
                    </div>

                    <div>
                        <select
                            value={carrier}
                            onChange={(e) => setCarrier(e.target.value)}
                            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="">Auto-detect</option>
                            <option value="UPS">UPS</option>
                            <option value="FedEx">FedEx</option>
                            <option value="USPS">USPS</option>
                            <option value="DHL">DHL</option>
                            <option value="Amazon">Amazon</option>
                        </select>
                    </div>

                    <button
                        type="submit"
                        disabled={isSubmitting || !trackingNumber.trim()}
                        className={`w-full py-2 rounded-lg font-black text-xs uppercase tracking-wider transition-all ${
                            showUrgentAlert
                                ? 'bg-red-600 hover:bg-red-700 text-white'
                                : 'bg-blue-600 hover:bg-blue-700 text-white'
                        } disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed`}
                    >
                        {isSubmitting ? 'Adding...' : 'Add Entry'}
                    </button>
                </form>
            </div>

            {/* Search Section at Bottom */}
            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {results.length > 0 && (
                        <div className="space-y-2">
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
                                            {result.status || 'Unknown'}
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

                <div className="border-t border-gray-200 p-4 space-y-2">
                    <div className="relative">
                        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                            <Search className="w-3 h-3 text-gray-400" />
                        </div>
                        <input
                            type="text"
                            placeholder="Search tracking..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyPress={handleSearchKeyPress}
                            className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2 pl-8 pr-3 text-[10px] font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder:text-gray-400"
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
            </div>
        </div>
    );
}
