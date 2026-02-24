'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import UpNextOrder from '../UpNextOrder';
import { ShipByDate } from '../ui/ShipByDate';
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
import { useLast8TrackingSearch } from '@/hooks/useLast8TrackingSearch';

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
    const inputRef = useRef<HTMLInputElement>(null);
    
    // Active order state - NEW unified state structure
    const [activeOrder, setActiveOrder] = useState<{
        id: number;
        orderId: string;
        productTitle: string;
        itemNumber: string | null;
        sku: string;
        condition: string;
        notes: string;
        tracking: string;
        serialNumbers: string[];
        testDateTime: string | null;
        testedBy: number | null;
        quantity?: number;
        shipByDate?: string | null;
        createdAt?: string | null;
    } | null>(null);
    
    // UI feedback messages
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [trackingNotFoundAlert, setTrackingNotFoundAlert] = useState<string | null>(null);
    
    // Search functionality
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showSearchResults, setShowSearchResults] = useState(false);
    const { normalizeTrackingQuery } = useLast8TrackingSearch();
    
    // Auto-clear messages after 0.5 seconds
    useEffect(() => {
        if (errorMessage || successMessage) {
            const timer = setTimeout(() => {
                setErrorMessage(null);
                setSuccessMessage(null);
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [errorMessage, successMessage]);

    useEffect(() => {
        if (!trackingNotFoundAlert) return;
        const timer = setTimeout(() => setTrackingNotFoundAlert(null), 2500);
        return () => clearTimeout(timer);
    }, [trackingNotFoundAlert]);

    useEffect(() => {
        const handleUndoApplied = (e: any) => {
            const tracking = String(e?.detail?.tracking || '');
            const serialNumbers = Array.isArray(e?.detail?.serialNumbers) ? e.detail.serialNumbers : [];
            const removedSerial = e?.detail?.removedSerial;
            if (!activeOrder) return;
            if (String(activeOrder.tracking || '') !== tracking) return;
            setActiveOrder({
                ...activeOrder,
                serialNumbers,
            });
            if (removedSerial) {
                setSuccessMessage(`Undo successful: removed ${removedSerial}`);
            } else {
                setSuccessMessage('Undo successful');
            }
        };

        window.addEventListener('tech-undo-applied' as any, handleUndoApplied as any);
        return () => window.removeEventListener('tech-undo-applied' as any, handleUndoApplied as any);
    }, [activeOrder]);

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

    const detectType = (val: string) => {
        const input = val.trim();

        // Priority 1: SKU with colon
        if (input.includes(':')) return 'SKU';

        // Priority 2: Tracking regex (carrier formats only)
        if (input.match(/^(1Z|42|93|96|JJD|JD|94|92|JVGL|420)/i)) return 'TRACKING';

        // Priority 3: X00/X0 FNSKU
        if (input.match(/^X0/i)) return 'FNSKU';

        // Commands
        if (['YES', 'USED', 'NEW', 'PARTS', 'TEST'].includes(input.toUpperCase())) return 'COMMAND';
        
        // Priority 4: Everything else is a serial number
        return 'SERIAL';
    };

    const getOrderIdLast4 = (orderId: string) => {
        const digits = String(orderId || '').replace(/\D/g, '');
        if (digits.length >= 4) return digits.slice(-4);
        return String(orderId || '').slice(-4);
    };

    const triggerGlobalRefresh = () => {
        if (onComplete) onComplete();
        window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    };

    const handleFnskuScan = async (fnskuInput: string) => {
        setIsLoading(true);
        try {
            const fnsku = fnskuInput.toUpperCase();
            const res = await fetch(`/api/tech/scan-fnsku?fnsku=${encodeURIComponent(fnsku)}&techId=${userId}`);
            const data = await res.json();

            if (!data.found) {
                setErrorMessage(data.error || 'FNSKU not found');
                setActiveOrder(null);
                return;
            }

            setActiveOrder({
                id: data.order.id,
                orderId: data.order.orderId,
                productTitle: data.order.productTitle,
                itemNumber: data.order.itemNumber ?? null,
                sku: data.order.sku,
                condition: data.order.condition,
                notes: data.order.notes,
                tracking: data.order.tracking,
                serialNumbers: data.order.serialNumbers || [],
                testDateTime: data.order.testDateTime,
                testedBy: data.order.testedBy,
                quantity: parseInt(String(data.order.quantity || 1), 10) || 1,
                shipByDate: data.order.shipByDate || null,
                createdAt: data.order.createdAt || null,
            });

            const serialCount = data.order.serialNumbers?.length || 0;
            if (serialCount > 0) {
                setSuccessMessage(`FNSKU loaded: ${serialCount} serial${serialCount !== 1 ? 's' : ''} already scanned`);
            } else {
                setSuccessMessage('FNSKU loaded - ready to scan serials');
            }

            triggerGlobalRefresh();
        } catch (err) {
            console.error('FNSKU scan failed:', err);
            setErrorMessage('Failed to load FNSKU. Please try again.');
        } finally {
            setIsLoading(false);
            setInputValue('');
            inputRef.current?.focus();
        }
    };

    const handleSubmit = async (e?: React.FormEvent, manualValue?: string) => {
        if (e) e.preventDefault();
        const input = (manualValue || inputValue).trim();
        if (!input) return;
        
        // Clear previous messages
        setErrorMessage(null);
        setSuccessMessage(null);
        setTrackingNotFoundAlert(null);
        
        const type = detectType(input);
        
        if (type === 'TRACKING') {
            setIsLoading(true);
            try {
                // Send full scanned tracking; API does last-8 lookup internally.
                const res = await fetch(`/api/tech/scan-tracking?tracking=${encodeURIComponent(input)}&techId=${userId}`);
                const data = await res.json();
                
                if (!data.found) {
                    setTrackingNotFoundAlert('Tracking number not found in the system');
                    setActiveOrder(null);
                    return;
                }
                
                // Load order with existing serials
                setActiveOrder({
                    id: data.order.id,
                    orderId: data.order.orderId,
                    productTitle: data.order.productTitle,
                    itemNumber: data.order.itemNumber ?? null,
                    sku: data.order.sku,
                    condition: data.order.condition,
                    notes: data.order.notes,
                    tracking: data.order.tracking,
                    serialNumbers: data.order.serialNumbers || [],
                    testDateTime: data.order.testDateTime,
                    testedBy: data.order.testedBy,
                    quantity: parseInt(String(data.order.quantity || 1), 10) || 1,
                    shipByDate: data.order.shipByDate || null,
                    createdAt: data.order.createdAt || null,
                });
                
                const serialCount = data.order.serialNumbers?.length || 0;
                if (serialCount > 0) {
                    setSuccessMessage(`Order loaded: ${serialCount} serial${serialCount !== 1 ? 's' : ''} already scanned`);
                } else {
                    setSuccessMessage('Order loaded - ready to scan serials');
                }
                
                // Trigger history refresh
                triggerGlobalRefresh();
            } catch (err) {
                console.error("Tracking scan failed:", err);
                setErrorMessage('Failed to load order. Please try again.');
            } finally {
                setIsLoading(false);
                setInputValue('');
                inputRef.current?.focus();
            }
        } else if (type === 'FNSKU') {
            await handleFnskuScan(input);
        } else if (type === 'SKU' && activeOrder) {
            // SKU with colon scan - lookup serials from sku table
            const skuCode = input;
            
            setIsLoading(true);
            try {
                const res = await fetch('/api/tech/scan-sku', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        skuCode,
                        tracking: activeOrder.tracking,
                        techId: userId
                    })
                });
                
                const data = await res.json();
                
                if (!data.success) {
                    setErrorMessage(data.error || 'Failed to process SKU');
                    return;
                }
                
                // Show notes alert if SKU has notes
                if (data.notes) {
                    alert(`Notes for SKU:\n\n${data.notes}`);
                }
                
                // Update active order with new serial list
                setActiveOrder({
                    ...activeOrder,
                    serialNumbers: data.updatedSerials
                });
                
                setSuccessMessage(
                    `SKU matched! Added ${data.serialNumbers.length} serial(s) from SKU lookup (Stock: -${data.quantityDecremented})`
                );
                
                // Trigger history refresh
                triggerGlobalRefresh();
            } catch (e) {
                console.error('SKU scan error:', e);
                setErrorMessage('Failed to process SKU');
            } finally {
                setIsLoading(false);
                setInputValue('');
                inputRef.current?.focus();
            }
        } else if (type === 'SKU' && !activeOrder) {
            // SKU scanned without active order
            setErrorMessage('Please scan a tracking number first');
        } else if (type === 'SERIAL' && activeOrder) {
            // Scan serial number and add to order
            const finalSerial = input.toUpperCase();
            
            setIsLoading(true);
            try {
                const res = await fetch('/api/tech/add-serial', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tracking: activeOrder.tracking,
                        serial: finalSerial,
                        techId: userId
                    })
                });
                
                const data = await res.json();
                
                if (!data.success) {
                    // Duplicate detected or other error
                    setErrorMessage(data.error || 'Failed to add serial');
                    return;
                }
                
                // Update active order with new serial list
                setActiveOrder({
                    ...activeOrder,
                    serialNumbers: data.serialNumbers
                });
                
                setSuccessMessage(`Serial ${finalSerial} added ✓ (${data.serialNumbers.length} total)`);
                
                // Trigger confetti if complete (future: check against quantity)
                if (data.isComplete) {
                    confetti({ particleCount: 100, spread: 70 });
                }
                
                // Trigger history refresh
                triggerGlobalRefresh();
            } catch (e) {
                console.error('Add serial error:', e);
                setErrorMessage('Network error occurred');
            } finally {
                setIsLoading(false);
                setInputValue('');
                inputRef.current?.focus();
            }
        } else if (type === 'SERIAL' && !activeOrder) {
            // Serial scanned without active order
            setErrorMessage('Please scan a tracking number first');
        } else if (type === 'COMMAND') {
            const command = input.toUpperCase();
            if (command === 'TEST') {
                // Test mode for debugging
                setActiveOrder({
                    id: 99999,
                    orderId: 'TEST-ORD-001',
                    productTitle: 'TEST UNIT - Sony Alpha a7 IV',
                    itemNumber: 'B000TEST000',
                    sku: 'TEST-SKU',
                    condition: 'Used - Excellent',
                    notes: 'This is a test order for debugging',
                    tracking: 'TEST-TRK-123',
                    serialNumbers: [],
                    testDateTime: null,
                    testedBy: null,
                    quantity: 1,
                    shipByDate: null,
                    createdAt: null
                });
                setSuccessMessage('Test order loaded');
            } else if (command === 'YES' && activeOrder) {
                // Close current work order
                setActiveOrder(null);
                setSuccessMessage('Order completed!');
                triggerGlobalRefresh();
            } else if (command === 'YES' && !activeOrder) {
                setErrorMessage('No active order to complete');
            }
        }
        
        setInputValue('');
        inputRef.current?.focus();
    };

    const handleSearch = async () => {
        if (!searchQuery.trim()) {
            setSearchResults([]);
            setShowSearchResults(false);
            return;
        }

        setIsSearching(true);
        try {
            const normalizedQuery = normalizeTrackingQuery(searchQuery);
            const res = await fetch(`/api/shipped/search?q=${encodeURIComponent(normalizedQuery)}`);
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
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header section */}
                <div className="p-4 pb-2 space-y-4">
                    <div className="space-y-0.5">
                        <h2 className="text-xl font-black text-gray-900 tracking-tighter">Welcome, {userName}</h2>
                    </div>

                    {/* Progress Bar - Moved above scan input */}
                    <div className="space-y-2 px-1">
                        <div className="flex items-center justify-between">
                            <p className={`text-[9px] font-black ${activeColor.text} tabular-nums`}>{todayCount} SHIPPED</p>
                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Goal: {goal}</p>
                        </div>
                        <div className="h-2 bg-gray-50 rounded-full overflow-hidden border border-gray-100 p-0.5">
                            <motion.div 
                                initial={{ width: 0 }} 
                                animate={{ width: `${Math.min((todayCount / goal) * 100, 100)}%` }} 
                                className={`h-full ${activeColor.bg} rounded-full shadow-sm`} 
                            />
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="relative group">
                        <div className={`absolute left-4 top-1/2 -translate-y-1/2 ${activeColor.text}`}>
                            <Barcode className="w-4 h-4" />
                        </div>
                        <input 
                            ref={inputRef}
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            placeholder="Scan Tracking, SKU, or SN..."
                            className={`w-full pl-11 pr-14 py-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-bold focus:ring-4 focus:ring-${themeColor}-500/10 focus:border-${themeColor}-500 outline-none transition-all shadow-inner`}
                            autoFocus
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            {isLoading ? (
                                <Loader2 className={`w-4 h-4 animate-spin ${activeColor.text}`} />
                            ) : (
                                <div className="px-1.5 py-0.5 bg-white rounded border border-gray-100 shadow-sm">
                                    <span className="text-[8px] font-black text-gray-400">ENTER</span>
                                </div>
                            )}
                        </div>
                    </form>

                    <AnimatePresence>
                        {trackingNotFoundAlert && (
                            <motion.div
                                initial={{ opacity: 0, y: -6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -6 }}
                                className="mt-2 p-3 bg-red-50 text-red-700 rounded-xl border border-red-200 flex items-center gap-2"
                            >
                                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                <p className="text-xs font-bold">{trackingNotFoundAlert}</p>
                            </motion.div>
                        )}
                    </AnimatePresence>

                </div>

                {/* Content Area - Vertical Stack */}
                <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-6 space-y-3">
                    {/* Error/Success Messages - Top Level */}
                    <AnimatePresence mode="wait">
                        {errorMessage && (
                            <motion.div 
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="p-4 bg-red-50 text-red-700 rounded-2xl border border-red-200 flex items-center gap-3"
                            >
                                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                                <p className="text-xs font-bold">{errorMessage}</p>
                            </motion.div>
                        )}
                        
                        {successMessage && !errorMessage && (
                            <motion.div 
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="p-4 bg-green-50 text-green-700 rounded-2xl border border-green-200 flex items-center gap-3"
                            >
                                <Check className="w-5 h-5 flex-shrink-0" />
                                <p className="text-xs font-bold">{successMessage}</p>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Active Order Card */}
                    <AnimatePresence mode="wait">
                        {activeOrder ? (
                            <motion.div 
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 10 }}
                                className="space-y-4"
                            >
                                <div className="rounded-2xl p-4 border transition-all relative shadow-sm bg-white border-gray-200">
                                    <div className="flex items-center justify-between mb-2">
                                        <ShipByDate date={String(activeOrder.shipByDate || activeOrder.createdAt || '')} />
                                        <span className="text-[9px] font-mono font-black text-gray-700">
                                            #{getOrderIdLast4(activeOrder.orderId)}
                                        </span>
                                    </div>

                                    <div className="mb-4">
                                        <h3 className="text-base font-black text-gray-900 leading-tight">
                                            {activeOrder.productTitle}
                                        </h3>
                                    </div>

                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Tracking #</p>
                                            <p className="text-xs font-mono font-bold text-gray-800">
                                                {String(activeOrder.tracking || '').slice(-4) || '—'}
                                            </p>
                                        </div>
                                        <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">SKU</p>
                                            <p className="text-xs font-mono font-bold text-gray-800">{activeOrder.sku}</p>
                                        </div>
                                        <div className={`rounded-xl px-3 py-2 border ${((activeOrder.quantity || 1) > 1) ? 'bg-yellow-300 border-yellow-400' : 'bg-gray-50 border-gray-100'}`}>
                                            <p className={`text-[9px] font-black uppercase tracking-wider mb-1 ${((activeOrder.quantity || 1) > 1) ? 'text-yellow-900' : 'text-gray-400'}`}>Qty</p>
                                            <p className={`text-xs font-mono font-black ${((activeOrder.quantity || 1) > 1) ? 'text-yellow-900' : 'text-gray-800'}`}>
                                                {activeOrder.quantity || 1}
                                            </p>
                                        </div>
                                    </div>

                                    {activeOrder.notes && (
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-2">
                                                <ClipboardList className={`w-4 h-4 ${activeColor.text}`} />
                                                <p className="text-[10px] font-black uppercase text-gray-500 tracking-widest">Testing Notes</p>
                                            </div>
                                            <p className="text-xs font-medium text-gray-700 bg-white/50 p-4 rounded-2xl border border-white/50 leading-relaxed">{activeOrder.notes}</p>
                                        </div>
                                    )}

                                    {/* Removed serial scan / YES hint */}
                                </div>

                                {/* Serial Numbers List (kept below active order card) */}
                                {activeOrder.serialNumbers.length > 0 && (
                                    <div className="rounded-2xl p-4 border border-emerald-100 bg-emerald-50/60 space-y-2">
                                        <p className="text-[9px] font-black text-emerald-700 uppercase tracking-wider">
                                            Scanned Serials ({activeOrder.serialNumbers.length})
                                        </p>
                                        <div className="space-y-1 max-h-40 overflow-y-auto">
                                            {activeOrder.serialNumbers.map((sn, idx) => (
                                                <motion.div
                                                    key={idx}
                                                    initial={{ opacity: 0, y: 4 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ delay: idx * 0.04 }}
                                                    className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-emerald-100"
                                                >
                                                    <Check className="w-3 h-3 text-emerald-600 flex-shrink-0" />
                                                    <span className="text-xs font-mono font-bold text-emerald-700">{sn}</span>
                                                </motion.div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        ) : null}
                    </AnimatePresence>

                    {/* Pending Orders Section with built-in tabs */}
                    <div className="space-y-3 mt-8">
                        <UpNextOrder 
                            techId={userId}
                            onStart={(tracking) => {
                                setActiveOrder(null);
                                setErrorMessage(null);
                                setSuccessMessage(null);
                                setTimeout(() => handleSubmit(undefined, tracking), 50);
                            }}
                            onMissingParts={(orderId, reason) => {
                                triggerGlobalRefresh();
                            }}
                        />
                    </div>

                    {/* Footer Logistics */}
                    <div className="mt-auto pt-6 border-t border-gray-50 text-center">
                        <p className="text-[9px] font-black text-gray-300 uppercase tracking-[0.3em]">USAV TECH v2.6</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
