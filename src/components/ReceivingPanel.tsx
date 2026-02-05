'use client';

import { useState, useEffect } from 'react';
import { Package, AlertTriangle, X, Search, Copy, Check, Loader2, Plus, ExternalLink } from './Icons';
import { SearchBar } from './ui/SearchBar';
import { motion, AnimatePresence } from 'framer-motion';

interface SearchResult {
    id: string;
    timestamp: string;
    tracking: string;
    status: string;
    count: number;
}

interface ReceivingPanelProps {
    onEntryAdded?: () => void;
    todayCount: number;
    averageTime: string;
}

export default function ReceivingPanel({ onEntryAdded, todayCount, averageTime }: ReceivingPanelProps) {
    const [trackingNumber, setTrackingNumber] = useState('');
    const [carrier, setCarrier] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [results, setResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const [mode, setMode] = useState<'entry' | 'search'>('entry');
    const [lastFound, setLastFound] = useState<SearchResult | null>(null);
    const [isManualMode, setIsManualMode] = useState(false);

    const handleSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!trackingNumber.trim()) return;

        if (mode === 'search') {
            await handleSearch();
            setMode('entry');
            return;
        }

        setIsSubmitting(true);
        setLastFound(null);
        try {
            const res = await fetch('/api/receiving-entry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trackingNumber,
                    carrier: carrier || 'Unknown',
                }),
            });

            if (!res.ok) throw new Error('Failed to add entry');

            setTrackingNumber('');
            if (onEntryAdded) onEntryAdded();
        } catch (error) {
            console.error('Error adding entry:', error);
            alert('Failed to add entry');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSearch = async () => {
        if (!trackingNumber.trim()) {
            setResults([]);
            return;
        }

        setIsSearching(true);
        setLastFound(null);
        try {
            const res = await fetch(`/api/receiving-logs/search?q=${encodeURIComponent(trackingNumber)}`);
            const data = await res.json();
            
            if (data.results && data.results.length > 0) {
                setResults(data.results);
                // If we found an exact or close match, show it as the last found
                const match = data.results.find((r: any) => r.tracking.includes(trackingNumber) || trackingNumber.includes(r.tracking));
                if (match) setLastFound(match);
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

    const copyToClipboard = (text: string, field: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
    };

    const getTrackingUrl = (tracking: string, carrier: string) => {
        const c = carrier?.toUpperCase() || '';
        if (c.includes('UPS')) return `https://www.ups.com/track?tracknum=${tracking}`;
        if (c.includes('FEDEX')) return `https://www.fedex.com/apps/fedextrack/?tracknumbers=${tracking}`;
        if (c.includes('USPS')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tracking}`;
        if (c.includes('DHL')) return `https://www.dhl.com/en/express/tracking.html?AWB=${tracking}`;
        if (c.includes('AMAZON')) return `https://www.amazon.com/progress-tracker/package/ref=pt_redirect_from_gp?trackingId=${tracking}`;
        return `https://www.google.com/search?q=${tracking}`;
    };

    return (
        <div className="flex flex-col h-full bg-white border-r border-gray-200">
            {/* Header with Metrics */}
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-black tracking-tighter text-gray-900 uppercase leading-none">
                        Receiving
                    </h2>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl">
                        <span className="text-[10px] font-black text-black-400 uppercase tracking-widest">Today</span>
                        <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">—</span>
                        <span className="text-sm font-black text-blue-600 leading-none">{todayCount}</span>
                    </div>
                </div>
            </div>

            {/* Unified Scan & Search Section */}
            <div className="p-4 border-b border-gray-200 space-y-3">
                <SearchBar 
                    value={trackingNumber}
                    onChange={(val) => {
                        setTrackingNumber(val);
                        if (mode === 'search' && !val) setMode('entry');
                    }}
                    onSearch={() => handleSubmit()}
                    placeholder={mode === 'entry' ? "Scan to Input..." : "Search Logs..."}
                    isSearching={isSubmitting || isSearching}
                    variant={mode === 'entry' ? 'blue' : 'emerald'}
                    rightElement={
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (mode === 'entry') {
                                    setMode('search');
                                    handleSearch().then(() => setMode('entry'));
                                } else {
                                    handleSearch();
                                }
                            }}
                            disabled={isSearching || !trackingNumber.trim()}
                            className={`p-3 rounded-2xl transition-all active:scale-95 shadow-lg disabled:cursor-not-allowed ${
                                mode === 'entry' 
                                    ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/10' 
                                    : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/10'
                            }`}
                            title="Search Logs"
                        >
                            {isSearching ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Search className="w-4 h-4" />
                            )}
                        </button>
                    }
                />

                {/* Manual Entry Mode Dropdown */}
                <div className="space-y-2">
                    <button
                        onClick={() => setIsManualMode(!isManualMode)}
                        className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.15em] text-gray-400 hover:text-blue-600 transition-colors px-1"
                    >
                        <div className={`w-3 h-3 rounded-full border-2 transition-all ${isManualMode ? 'bg-blue-600 border-blue-600 scale-110' : 'border-gray-200'}`} />
                        Manual Entry Mode
                    </button>

                    <AnimatePresence>
                        {isManualMode && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                            >
                                <select
                                    value={carrier}
                                    onChange={(e) => setCarrier(e.target.value)}
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-[11px] font-black uppercase tracking-wider outline-none focus:ring-4 focus:ring-blue-500/10 transition-all cursor-pointer shadow-inner"
                                >
                                    <option value="">Auto-detect Carrier</option>
                                    <option value="UPS">UPS</option>
                                    <option value="FEDEX">FedEx</option>
                                    <option value="USPS">USPS</option>
                                    <option value="AMAZON">Amazon</option>
                                    <option value="DHL">DHL</option>
                                </select>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>

            {/* Found Record Component */}
            <AnimatePresence>
                {lastFound && (
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="m-4 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl shadow-sm relative overflow-hidden group"
                    >
                        <div className="relative z-10">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 bg-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-600/20">
                                        <Check className="w-4 h-4 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black text-emerald-900 uppercase tracking-tight leading-none">Entry Found</p>
                                        <p className="text-[8px] font-bold text-emerald-600 uppercase tracking-[0.2em] mt-1">Verified Record</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setLastFound(null)}
                                    className="p-2 bg-white hover:bg-emerald-100 text-emerald-600 rounded-xl border border-emerald-100 transition-all active:scale-95 shadow-sm"
                                    title="Close"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>

                            <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Carrier</span>
                                    <span className="text-[11px] font-black text-gray-900 uppercase bg-white/50 px-2 py-0.5 rounded-lg border border-emerald-100/50">
                                        {lastFound.status || 'UPS'}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Tracking</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[11px] font-black font-mono text-blue-600">
                                            {lastFound.tracking.slice(-8)}
                                        </span>
                                        <button
                                            onClick={() => copyToClipboard(lastFound.tracking, 'found-tracking')}
                                            className="p-1 hover:bg-white rounded transition-all text-emerald-600"
                                            title="Copy Tracking #"
                                        >
                                            {copiedField === 'found-tracking' ? (
                                                <Check className="w-3 h-3" />
                                            ) : (
                                                <Copy className="w-3 h-3" />
                                            )}
                                        </button>
                                    </div>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Arrived</span>
                                    <span className="text-[10px] font-black text-gray-900 uppercase">
                                        {new Date(lastFound.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })} — {new Date(lastFound.timestamp).toLocaleDateString()}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Results Section */}
            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {results.length > 0 && !lastFound && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between mb-2 px-1">
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Search Results</p>
                                <button 
                                    onClick={() => setResults([])}
                                    className="text-[10px] font-bold text-blue-600 uppercase hover:underline"
                                >
                                    Clear
                                </button>
                            </div>
                            
                            {results.map((result) => (
                                <div
                                    key={result.id}
                                    className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2 hover:border-blue-300 transition-all"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-[10px] font-mono font-bold text-blue-600 flex-1">
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
                                            {new Date(result.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })} — {new Date(result.timestamp).toLocaleDateString()}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
