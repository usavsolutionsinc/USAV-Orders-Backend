'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CurrentOrder from '../CurrentOrder';
import ActiveProductInfo from '../ActiveProductInfo';
import { 
  Search, 
  Check, 
  X, 
  Package, 
  Loader2,
  Barcode,
  ClipboardList,
  ShieldCheck,
  Zap,
  History,
  LayoutDashboard
} from '../Icons';

interface StationTestingProps {
    userId: string;
    userName: string;
    sheetId: string;
    gid?: string;
    themeColor?: 'green' | 'blue' | 'purple';
    todayCount: number;
    goal?: number;
    onComplete?: () => void;
}

export default function StationTesting({ 
    userId, 
    userName,
    sheetId, 
    gid,
    themeColor = 'purple',
    todayCount = 0,
    goal = 50,
    onComplete
}: StationTestingProps) {
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [processedOrder, setProcessedOrder] = useState<any>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    
    // Search functionality
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showSearchResults, setShowSearchResults] = useState(false);

    // Color definitions
    const colors = {
        green: {
            bg: 'bg-emerald-600',
            hover: 'hover:bg-emerald-700',
            light: 'bg-emerald-50',
            border: 'border-emerald-100',
            text: 'text-emerald-600',
            shadow: 'shadow-emerald-100'
        },
        blue: {
            bg: 'bg-blue-600',
            hover: 'hover:bg-blue-700',
            light: 'bg-blue-50',
            border: 'border-blue-100',
            text: 'text-blue-600',
            shadow: 'shadow-blue-100'
        },
        purple: {
            bg: 'bg-purple-600',
            hover: 'hover:bg-purple-700',
            light: 'bg-purple-50',
            border: 'border-purple-100',
            text: 'text-purple-600',
            shadow: 'shadow-purple-100'
        }
    };

    const activeColor = colors[themeColor];

    const mockProduct = {
        title: 'Sony Alpha a7 IV Mirrorless Camera',
        sku: 'SONY-A7IV-01',
        condition: 'Used - Excellent',
        notes: 'Check sensor for dust. Verify firmware v2.0.',
        customer: 'John Doe',
        orderId: 'ORD-7721'
    };

    const detectType = (val: string) => {
        const input = val.trim();
        
        // Priority 1: SKU with colon (from Working GAS logic)
        if (input.includes(':')) return 'SKU';
        
        // Priority 2: Tracking number regex (from Working GAS line 844)
        if (input.match(/^(1Z|42|93|96|JJD|JD|94|92|JVGL|420)/i)) return 'TRACKING';
        
        // Priority 3: FBA FNSKU (skip per user request)
        // if (/^X0/i.test(input)) return 'FNSKU';
        
        // Commands
        if (['YES', 'USED', 'NEW', 'PARTS', 'TEST'].includes(input.toUpperCase())) return 'COMMAND';
        
        // Priority 4: Everything else is a serial number
        return 'SERIAL';
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const input = inputValue.trim();
        if (!input) return;
        
        const type = detectType(input);
        
        if (type === 'TRACKING') {
            setIsLoading(true);
            try {
                const res = await fetch(`/api/tech-logs/search?tracking=${input}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.found) {
                        setProcessedOrder({
                            title: data.productName,
                            sku: data.sku || 'N/A',
                            condition: data.condition || 'N/A',
                            notes: data.notes || 'N/A',
                            customer: data.customer || 'N/A',
                            orderId: data.orderId || 'N/A',
                            tracking: input
                        });
                    } else {
                        setProcessedOrder({
                            title: 'Unknown Product',
                            sku: 'N/A',
                            orderId: 'N/A',
                            tracking: input,
                            notes: 'Tracking not found in Shipped table.'
                        });
                    }
                }
            } catch (err) {
                console.error("Search failed:", err);
            } finally {
                setIsLoading(false);
            }
        } else if (type === 'SERIAL' && processedOrder) {
            // If we have an active order and input is a serial, just keep it in input or move to a serial state
            // For now, let's just let it stay in inputValue and the user can click Complete or press Enter again
            // Let's call handleComplete if we have a serial and an active order
            setInputValue(input.toUpperCase());
            return; 
        } else if (type === 'COMMAND' && input.toUpperCase() === 'TEST') {
            setProcessedOrder({ ...mockProduct, title: 'TEST UNIT', sku: 'TEST-SKU', tracking: 'TEST-TRK' });
        }
        
        setInputValue('');
        inputRef.current?.focus();
    };

    const handleComplete = async () => {
        if (!processedOrder) return;

        setIsLoading(true);
        try {
            // Get local timestamp in M/D/YYYY HH:mm:ss format to match DB expectation
            const now = new Date();
            const timestamp = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

            const res = await fetch('/api/tech-logs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    techId: userId,
                    userName, // Pass technician name for Shipped table update
                    timestamp,
                    title: processedOrder.title,
                    tracking: processedOrder.tracking || processedOrder.orderId,
                    serial: inputValue.trim().toUpperCase() || ('SN-' + Math.random().toString(36).substr(2, 9).toUpperCase()),
                    count: todayCount + 1
                })
            });
            
            if (res.ok) {
                if (onComplete) onComplete();
                setProcessedOrder(null);
                setInputValue('');
                inputRef.current?.focus();
            } else {
                const err = await res.json();
                alert(`Error: ${err.error || 'Failed to complete task'}`);
            }
        } catch (e) {
            console.error(e);
            alert('Network error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSearch = async () => {
        if (!searchQuery.trim()) {
            setSearchResults([]);
            setShowSearchResults(false);
            return;
        }

        setIsSearching(true);
        try {
            const res = await fetch(`/api/shipped/search?q=${encodeURIComponent(searchQuery)}`);
            const data = await res.json();
            
            if (data.results) {
                setSearchResults(data.results);
                setShowSearchResults(true);
            }
        } catch (error) {
            console.error('Search error:', error);
            setSearchResults([]);
        } finally {
            setIsSearching(false);
        }
    };

    const handleSearchKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    };

    return (
        <div className="flex flex-col h-full bg-white overflow-hidden border-r border-gray-100">
            {/* Header section */}
            <div className="p-8 pb-4 space-y-8">
                <div className="space-y-1">
                    <h2 className="text-2xl font-black text-gray-900 tracking-tighter">Welcome, {userName}</h2>
                </div>

                {/* Progress Bar - Moved above scan input */}
                <div className="space-y-3 px-2">
                    <div className="flex items-center justify-between">
                        <p className={`text-[10px] font-black ${activeColor.text} tabular-nums`}>{todayCount} SHIPPED</p>
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Goal: {goal}</p>
                    </div>
                    <div className="h-2.5 bg-gray-50 rounded-full overflow-hidden border border-gray-100 p-0.5">
                        <motion.div 
                            initial={{ width: 0 }} 
                            animate={{ width: `${Math.min((todayCount / goal) * 100, 100)}%` }} 
                            className={`h-full ${activeColor.bg} rounded-full shadow-sm`} 
                        />
                    </div>
                </div>

                {/* Single Entry Form */}
                <form onSubmit={handleSubmit} className="relative group">
                    <div className={`absolute left-5 top-1/2 -translate-y-1/2 ${activeColor.text}`}>
                        <Barcode className="w-5 h-5" />
                    </div>
                    <input 
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder="Scan Tracking, SKU, or SN..."
                        className={`w-full pl-14 pr-14 py-5 bg-gray-50 border border-gray-100 rounded-[1.5rem] text-sm font-bold focus:ring-4 focus:ring-${themeColor}-500/10 focus:border-${themeColor}-500 outline-none transition-all shadow-inner`}
                        autoFocus
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                        {isLoading ? (
                            <Loader2 className={`w-5 h-5 animate-spin ${activeColor.text}`} />
                        ) : (
                            <div className="px-2 py-1 bg-white rounded-md border border-gray-100 shadow-sm">
                                <span className="text-[9px] font-black text-gray-400">ENTER</span>
                            </div>
                        )}
                    </div>
                </form>
            </div>

            {/* Content Area - Vertical Stack */}
            <div className="flex-1 overflow-y-auto no-scrollbar px-8 pb-8 space-y-4">
                {/* Active Product Info - Shows immediately under scan field */}
                {processedOrder && (
                    <ActiveProductInfo 
                        orderId={processedOrder.orderId || 'N/A'}
                        productTitle={processedOrder.title}
                    />
                )}
                
                {/* Current Order Display - Original detailed view */}
                {processedOrder && (
                    <CurrentOrder 
                        orderId={processedOrder.orderId || 'N/A'}
                        productTitle={processedOrder.title}
                    />
                )}

                <AnimatePresence mode="wait">
                    {processedOrder ? (
                        <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            className="space-y-4"
                        >
                            <div className={`${activeColor.light} rounded-[2rem] p-6 border ${activeColor.border} space-y-6`}>
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className={`w-1.5 h-1.5 rounded-full ${activeColor.bg} animate-pulse`} />
                                        <p className={`text-[10px] font-black ${activeColor.text} uppercase tracking-widest`}>Active Order</p>
                                    </div>
                                    <h3 className="text-lg font-black text-gray-900 leading-tight tracking-tighter">{processedOrder.title}</h3>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="p-4 bg-white/80 backdrop-blur-sm rounded-2xl border border-white shadow-sm">
                                        <p className="text-[9px] font-black text-gray-400 uppercase mb-1">SKU</p>
                                        <p className="text-xs font-bold text-gray-900 truncate">{processedOrder.sku}</p>
                                    </div>
                                    <div className="p-4 bg-white/80 backdrop-blur-sm rounded-2xl border border-white shadow-sm">
                                        <p className="text-[9px] font-black text-gray-400 uppercase mb-1">Order</p>
                                        <p className="text-xs font-bold text-gray-900 truncate">{processedOrder.orderId}</p>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex items-center gap-2">
                                        <ClipboardList className={`w-4 h-4 ${activeColor.text}`} />
                                        <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest">Testing Notes</p>
                                    </div>
                                    <p className="text-xs font-medium text-gray-700 bg-white/50 p-4 rounded-2xl border border-white/50 leading-relaxed">{processedOrder.notes}</p>
                                </div>

                                <button 
                                    onClick={handleComplete}
                                    className={`w-full py-4 ${activeColor.bg} ${activeColor.hover} text-white rounded-[1.5rem] font-black uppercase tracking-widest text-[10px] transition-all active:scale-[0.98] shadow-xl ${activeColor.shadow} flex items-center justify-center gap-3`}
                                >
                                    <Check className="w-4 h-4" />
                                    Complete Task
                                </button>
                            </div>
                        </motion.div>
                    ) : null}
                </AnimatePresence>

                {/* Footer Logistics */}
                <div className="mt-8 pt-6 border-t border-gray-50 text-center">
                    <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.3em]">USAV TECH v2.6</p>
                </div>
            </div>

            {/* Minimal Search Field at Bottom */}
            <div className="p-4 border-t border-gray-100 bg-white">
                <div className="relative">
                    <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                        <Search className="w-3.5 h-3.5 text-gray-400" />
                    </div>
                    <input
                        type="text"
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyPress={handleSearchKeyPress}
                        className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2 pl-9 pr-3 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder:text-gray-400"
                    />
                    {isSearching && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                        </div>
                    )}
                </div>

                {/* Search Results Modal */}
                <AnimatePresence>
                    {showSearchResults && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="absolute bottom-full left-0 right-0 mb-2 mx-4 bg-white border border-gray-200 rounded-xl shadow-2xl max-h-96 overflow-y-auto z-50"
                        >
                            <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-2 flex items-center justify-between">
                                <p className="text-xs font-bold text-gray-600">
                                    {searchResults.length} Result{searchResults.length !== 1 ? 's' : ''}
                                </p>
                                <button
                                    onClick={() => setShowSearchResults(false)}
                                    className="p-1 hover:bg-gray-100 rounded transition-all"
                                >
                                    <X className="w-4 h-4 text-gray-400" />
                                </button>
                            </div>
                            
                            {searchResults.length > 0 ? (
                                <div className="p-2 space-y-2">
                                    {searchResults.map((result) => {
                                        // Show last 6 digits for tracking number
                                        const trackingDisplay = result.order_id && result.order_id.length > 6 
                                            ? result.order_id.slice(-6) 
                                            : result.order_id;
                                        
                                        return (
                                        <div
                                            key={result.id}
                                            className="bg-gray-50 border border-gray-200 rounded-lg p-3 hover:border-blue-300 transition-all"
                                        >
                                            <div className="flex items-center justify-between mb-2">
                                                <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${
                                                    result.is_shipped 
                                                        ? 'bg-emerald-100 text-emerald-700'
                                                        : 'bg-amber-100 text-amber-700'
                                                }`}>
                                                    {result.is_shipped ? '✓ Shipped' : '○ Pending'}
                                                </span>
                                            </div>
                                            
                                            {result.serial_number && (
                                                <div className="bg-emerald-600 text-white p-2 rounded-lg mb-2">
                                                    <p className="text-[8px] font-bold uppercase opacity-80 mb-0.5">
                                                        Serial Number
                                                    </p>
                                                    <p className="text-xs font-black font-mono">
                                                        {result.serial_number}
                                                    </p>
                                                </div>
                                            )}
                                            
                                            <div className="space-y-1 text-[10px]">
                                                <div className="flex justify-between">
                                                    <span className="text-gray-500 font-bold">Product</span>
                                                    <span className="font-semibold text-right">{result.customer}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-500 font-bold">Condition</span>
                                                    <span className="font-semibold text-right">{result.product}</span>
                                                </div>
                                                <div className="flex justify-between pt-1 border-t border-gray-200">
                                                    <span className="text-gray-500 font-bold">Tracking</span>
                                                    <span className="font-mono font-semibold">{trackingDisplay}</span>
                                                </div>
                                            </div>
                                        </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="p-8 text-center">
                                    <Package className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                                    <p className="text-xs font-bold text-gray-400">No Results Found</p>
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
