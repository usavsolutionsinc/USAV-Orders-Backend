'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
    const [isMobile, setIsMobile] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

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

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 1024);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    const mockProduct = {
        title: 'Sony Alpha a7 IV Mirrorless Camera',
        sku: 'SONY-A7IV-01',
        condition: 'Used - Excellent',
        notes: 'Check sensor for dust. Verify firmware v2.0.',
        customer: 'John Doe',
        orderId: 'ORD-7721'
    };

    const detectType = (val: string) => {
        const input = val.trim().toUpperCase();
        if (input.match(/^(1Z|42|93|96|JJD|JD|94|92|JVGL|420)/i)) return 'TRACKING';
        if (input.includes(':') || input.match(/^(\d+)(?:[xX](\d+))?$/i) || input.match(/^(\d+)-([A-Z])$/i)) return 'SKU';
        if (['YES', 'USED', 'NEW', 'PARTS', 'TEST'].includes(input)) return 'COMMAND';
        return 'SERIAL';
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputValue) return;
        
        setIsLoading(true);
        const type = detectType(inputValue);
        
        // Mock processing logic
        setTimeout(() => {
            if (type === 'TRACKING') {
                setProcessedOrder(mockProduct);
            } else if (type === 'COMMAND' && inputValue.toUpperCase() === 'TEST') {
                setProcessedOrder({ ...mockProduct, title: 'TEST UNIT', sku: 'TEST-SKU' });
            }
            setInputValue('');
            setIsLoading(false);
            inputRef.current?.focus();
        }, 600);
    };

    const handleComplete = async () => {
        if (!processedOrder) return;

        setIsLoading(true);
        try {
            await fetch('/api/tech-logs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    techId: userId,
                    timestamp: new Date().toISOString(),
                    title: processedOrder.title,
                    tracking: processedOrder.orderId, // Using orderId as mock tracking
                    serial: 'SN-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
                    count: todayCount + 1
                })
            });
            
            if (onComplete) onComplete();
            setProcessedOrder(null);
            setInputValue('');
            inputRef.current?.focus();
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-white overflow-hidden border-r border-gray-100">
            {/* Header section */}
            <div className="p-8 pb-4 space-y-8">
                <div className="space-y-1">
                    <h2 className="text-2xl font-black text-gray-900 tracking-tighter">Welcome, {userName}</h2>
                </div>

                {/* Single Entry Form */}
                <div className="space-y-6">
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

                    {/* Progress Bar */}
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
                </div>
            </div>

            {/* Content Area - Vertical Stack */}
            <div className="flex-1 overflow-y-auto no-scrollbar px-8 pb-8">
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
        </div>
    );
}
