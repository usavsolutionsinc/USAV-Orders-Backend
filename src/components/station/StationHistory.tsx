'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Package, Loader2, List, ChevronRight } from '../Icons';
import { motion, AnimatePresence } from 'framer-motion';
import Checklist from '../Checklist';

interface HistoryLog {
    id: string;
    timestamp: string;
    title?: string;
    tracking?: string;
    serial?: string;
    status?: string;
    count?: number;
}

interface StationHistoryProps {
    history: HistoryLog[];
    isLoading: boolean;
    title?: string;
    techId?: string;
    stationType?: 'packing' | 'testing';
}

export default function StationHistory({ history, isLoading, title = "Orders History", techId, stationType }: StationHistoryProps) {
    const [isChecklistOpen, setIsChecklistOpen] = useState(false);
    const [stickyDate, setStickyDate] = useState<string>('');
    const [currentCount, setCurrentCount] = useState<number>(0);
    const scrollRef = useRef<HTMLDivElement>(null);

    const formatDate = (dateStr: string) => {
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        } catch (e) { return dateStr; }
    };

    useEffect(() => {
        const handleScroll = () => {
            if (!scrollRef.current) return;
            const container = scrollRef.current;
            const scrollPos = container.scrollTop;
            
            const items = container.querySelectorAll('[data-date]');
            let visibleDate = '';
            let visibleCount = 0;

            for (let i = 0; i < items.length; i++) {
                const item = items[i] as HTMLElement;
                if (item.offsetTop - container.offsetTop <= scrollPos + 100) {
                    visibleDate = item.getAttribute('data-date') || '';
                    visibleCount = parseInt(item.getAttribute('data-count') || '0');
                }
            }

            if (visibleDate) setStickyDate(formatDate(visibleDate));
            if (visibleCount) setCurrentCount(visibleCount);
        };

        const container = scrollRef.current;
        if (container) {
            container.addEventListener('scroll', handleScroll);
            handleScroll();
        }
        return () => container?.removeEventListener('scroll', handleScroll);
    }, [history]);

    return (
        <div className="flex flex-col h-full w-full bg-white relative overflow-hidden">
            {/* Sticky Header - Spans full width */}
            <div className="flex-shrink-0 z-20 bg-white/90 backdrop-blur-md border-b border-gray-100 px-8 py-4 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-6">
                    <p className="text-sm font-black text-gray-900 tracking-tight min-w-[120px]">
                        {stickyDate || (history.length > 0 ? formatDate(history[0].timestamp) : 'Today')}
                    </p>
                    <div className="h-4 w-px bg-gray-200" />
                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">
                        Daily Count: {currentCount || (history.length > 0 ? history[0].count : 0)}
                    </p>
                </div>
                
                {techId && (
                    <button 
                        onClick={() => setIsChecklistOpen(!isChecklistOpen)}
                        className={`p-2.5 rounded-xl transition-all ${isChecklistOpen ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
                        title="Toggle Checklist"
                    >
                        <List className="w-5 h-5" />
                    </button>
                )}
            </div>

            {/* Logs Area - Spans full width */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar w-full">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-40 gap-3 text-gray-400">
                        <Loader2 className="w-8 h-8 animate-spin" />
                        <p className="text-[10px] font-black uppercase tracking-widest">Loading Records...</p>
                    </div>
                ) : history.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-40 text-center opacity-20">
                        <Package className="w-16 h-16 mb-4" />
                        <p className="text-[10px] font-black uppercase tracking-widest">No Logs Found</p>
                    </div>
                ) : (
                    <div className="flex flex-col min-w-0">
                        {history.map((log, index) => (
                            <motion.div 
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                key={log.id} 
                                data-date={log.timestamp.split('T')[0]}
                                data-count={log.count}
                                className={`grid grid-cols-[100px_2.5fr_1fr_1.5fr_1.5fr] items-center gap-8 px-8 py-2.5 transition-colors border-b border-gray-50/50 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
                            >
                                <div className="text-[10px] font-black text-gray-400 tabular-nums uppercase">
                                    {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                                </div>
                                <div className="text-xs font-bold text-gray-900 truncate">
                                    {log.title || 'Unknown Product'}
                                </div>
                                <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest text-center truncate">
                                    {log.status || '---'}
                                </div>
                                <div className="text-[11px] font-mono font-bold text-blue-600 bg-blue-50/50 px-3 py-1.5 rounded-lg text-center truncate border border-blue-100/50">
                                    {log.tracking}
                                </div>
                                <div className="text-[11px] font-mono font-bold text-emerald-600 bg-emerald-50/50 px-3 py-1.5 rounded-lg text-center truncate border border-emerald-100/50">
                                    {log.serial || '---'}
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}
            </div>

            {/* Overlay Checklist Menu */}
            <AnimatePresence>
                {isChecklistOpen && techId && (
                    <>
                        {/* Backdrop */}
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsChecklistOpen(false)}
                            className="absolute inset-0 bg-black/10 backdrop-blur-[2px] z-30"
                        />
                        {/* Drawer */}
                        <motion.div 
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '100%' }}
                            transition={{ type: "spring", damping: 25, stiffness: 200 }}
                            className="absolute top-0 right-0 h-full bg-white w-[400px] shadow-[-20px_0_50px_rgba(0,0,0,0.1)] z-40 flex flex-col border-l border-gray-100"
                        >
                            <div className="p-6 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-100">
                                        <List className="w-4 h-4 text-white" />
                                    </div>
                                    <p className="text-sm font-black uppercase tracking-widest text-gray-900">Task Checklist</p>
                                </div>
                                <button 
                                    onClick={() => setIsChecklistOpen(false)} 
                                    className="p-2 bg-white text-gray-400 rounded-xl hover:bg-gray-100 transition-colors shadow-sm"
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto no-scrollbar">
                                <Checklist role="technician" userId={techId} />
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
