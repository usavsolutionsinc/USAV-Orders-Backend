'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CurrentOrder from '../CurrentOrder';
import ActiveProductInfo from '../ActiveProductInfo';
import UpNextOrder from '../UpNextOrder';
import CurrentWorkOrder from '../CurrentWorkOrder';
import confetti from 'canvas-confetti';
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
  LayoutDashboard,
  AlertCircle
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
    const [activeSubTab, setActiveSubTab] = useState<'current' | 'pending' | 'out-of-stock'>('current');
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [processedOrder, setProcessedOrder] = useState<any>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    
    // Current work order state
    const [scannedTrackingNumber, setScannedTrackingNumber] = useState<string | null>(null);
    const [currentWorkOrder, setCurrentWorkOrder] = useState<{ id: string; productTitle: string; orderId: string; sku?: string; condition?: string; serialNumber?: string } | null>(null);
    const [serialNumber, setSerialNumber] = useState('');
    
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
        // Added X0 for FNSKU support as per user request
        if (input.match(/^(1Z|42|93|96|JJD|JD|94|92|JVGL|420|X0)/i)) return 'TRACKING';
        
        // Priority 3: FBA FNSKU (skip per user request)
        // if (/^X0/i.test(input)) return 'FNSKU';
        
        // Commands
        if (['YES', 'USED', 'NEW', 'PARTS', 'TEST'].includes(input.toUpperCase())) return 'COMMAND';
        
        // Priority 4: Everything else is a serial number
        return 'SERIAL';
    };

    const handleSubmit = async (e?: React.FormEvent, manualValue?: string) => {
        if (e) e.preventDefault();
        const input = (manualValue || inputValue).trim();
        if (!input) return;
        
        const type = detectType(input);
        
        if (type === 'TRACKING') {
            // Set the scanned tracking number to trigger CurrentWorkOrder lookup
            setScannedTrackingNumber(input);
            setCurrentWorkOrder(null); // Reset current work order
            
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
        } else if (type === 'SERIAL' && (currentWorkOrder || processedOrder)) {
            // Priority 4: Everything else is a serial number
            // If we have an active order, this scan should complete the task
            const finalSerial = input.toUpperCase();
            setSerialNumber(finalSerial);
            
            // Auto-complete logic
            setIsLoading(true);
            try {
                const now = new Date();
                const timestamp = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

                const targetOrder = currentWorkOrder || processedOrder;
                const tracking = scannedTrackingNumber || targetOrder.tracking || targetOrder.orderId;

                const res = await fetch('/api/tech-logs', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        techId: userId,
                        userName,
                        timestamp,
                        title: targetOrder.productTitle || targetOrder.title,
                        tracking,
                        serial: finalSerial
                    })
                });

                if (res.ok) {
                    setSerialNumber('');
                    setScannedTrackingNumber(null);
                    setCurrentWorkOrder(null);
                    setProcessedOrder(null);
                    if (onComplete) onComplete();
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
                    serial: inputValue.trim().toUpperCase() || ('SN-' + Math.random().toString(36).substr(2, 9).toUpperCase())
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

    const handleSaveSerialNumber = async (e: React.FormEvent) => {
        // ... kept for potential internal use but UI div removed
    };

    return (
        <div className="flex flex-col h-full bg-white overflow-hidden border-r border-gray-100">
            <div className="flex-1 flex flex-col overflow-hidden">
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

                    {/* Horizontal Sub-menu - Moved below scan input */}
                    <div className="flex items-center justify-center gap-1 py-2 bg-gray-50/50 rounded-2xl p-1">
                        {[
                            { id: 'current', icon: Zap, label: 'Current' },
                            { id: 'pending', icon: ClipboardList, label: 'Pending' },
                            { id: 'out-of-stock', icon: AlertCircle, label: 'Stock' }
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveSubTab(tab.id as any)}
                                className={`flex-1 px-4 py-2.5 rounded-xl transition-all relative flex items-center justify-center gap-2 ${
                                    activeSubTab === tab.id 
                                        ? activeColor.text + ' bg-white shadow-sm ring-1 ring-gray-200/50' 
                                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100/50'
                                }`}
                            >
                                <tab.icon className="w-4 h-4" />
                                <span className="text-[10px] font-black uppercase tracking-widest">{tab.label}</span>
                                {activeSubTab === tab.id && (
                                    <motion.div 
                                        layoutId="activeSubTab"
                                        className={`absolute bottom-0 left-0 right-0 h-0.5 ${activeColor.bg} rounded-full mx-2`}
                                    />
                                )}
                            </button>
                        ))}
                    </div>

                    {activeSubTab === 'current' && (
                        <CurrentWorkOrder 
                            trackingNumber={scannedTrackingNumber}
                            capturedSerialNumber={serialNumber}
                            onLoaded={setCurrentWorkOrder}
                        />
                    )}
                </div>

                {/* Content Area - Vertical Stack */}
                <div className="flex-1 overflow-y-auto no-scrollbar px-8 pb-8 space-y-4">
                    {activeSubTab === 'current' ? (
                        <>
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

                                            {serialNumber && (
                                                <div className="p-4 bg-emerald-600 text-white rounded-2xl shadow-lg">
                                                    <p className="text-[9px] font-black uppercase opacity-80 mb-1">Captured Serial</p>
                                                    <p className="text-sm font-mono font-black">{serialNumber}</p>
                                                </div>
                                            )}

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
                        </>
                    ) : activeSubTab === 'pending' ? (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest">Pending Work Orders</h3>
                            </div>
                            <UpNextOrder 
                                techId={userId}
                                onStart={(tracking) => {
                                    setScannedTrackingNumber(null);
                                    setCurrentWorkOrder(null);
                                    setProcessedOrder(null);
                                    setSerialNumber('');
                                    setActiveSubTab('current');
                                    setTimeout(() => handleSubmit(undefined, tracking), 50);
                                }}
                                onMissingParts={(orderId, reason) => {
                                    if (onComplete) onComplete();
                                }}
                                showAllPending={true}
                            />
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest">What's out of stock</h3>
                            </div>
                            <UpNextOrder 
                                techId={userId}
                                onStart={() => {}}
                                onMissingParts={() => {}}
                                showOnlyOutOfStock={true}
                            />
                        </div>
                    )}

                    {/* Footer Logistics */}
                    <div className="mt-auto pt-6 border-t border-gray-50 text-center">
                        <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.3em]">USAV TECH v2.6</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
