'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Package, Loader2, Clock, List, ChevronRight } from '../Icons';
import { motion, AnimatePresence } from 'framer-motion';
import Checklist from '../Checklist';

interface HistoryLog {
    id: string;
    timestamp: string;
    title?: string;
    tracking?: string;
    serial?: string;
    count?: number;
}

interface StationHistoryProps {
    history: HistoryLog[];
    isLoading: boolean;
    title?: string;
    techId?: string;
}

export default function StationHistory({ history, isLoading, title = "Orders History", techId }: StationHistoryProps) {
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
            
            // Find the visible date based on scroll position
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
        <div className="flex h-full bg-white relative">
            <div className="flex-1 flex flex-col h-full overflow-hidden">
                {/* Sticky Header */}
                <div className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-gray-100 px-8 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <p className="text-sm font-black text-gray-900 tracking-tight">
                            {stickyDate || (history.length > 0 ? formatDate(history[0].timestamp) : 'Today')}
                        </p>
                        <div className="h-4 w-px bg-gray-200" />
                        <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">
                            Daily Count: {currentCount || (history.length > 0 ? history[0].count : 0)}
                        </p>
                    </div>
                    
                    <button 
                        onClick={() => setIsChecklistOpen(!isChecklistOpen)}
                        className={`p-2 rounded-xl transition-all ${isChecklistOpen ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}
                    >
                        <List className="w-5 h-5" />
                    </button>
                </div>

                <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar px-8 py-6">
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
                        <div className="space-y-3">
                            {history.map((log) => (
                                <motion.div 
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    key={log.id} 
                                    data-date={log.timestamp.split('T')[0]}
                                    data-count={log.count}
                                    className="grid grid-cols-[100px_1fr_150px_150px] items-center gap-6 p-5 bg-gray-50/50 hover:bg-white rounded-2xl border border-gray-100 hover:border-blue-100 hover:shadow-xl hover:shadow-gray-100/50 transition-all group"
                                >
                                    <div className="text-[10px] font-black text-gray-400 tabular-nums">
                                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                    <div className="text-sm font-bold text-gray-900 truncate">
                                        {log.title || 'Unknown Product'}
                                    </div>
                                    <div className="text-[11px] font-mono font-bold text-blue-600 bg-blue-50/50 px-3 py-1.5 rounded-lg text-center truncate">
                                        {log.tracking}
                                    </div>
                                    <div className="text-[11px] font-mono font-bold text-emerald-600 bg-emerald-50/50 px-3 py-1.5 rounded-lg text-center truncate">
                                        {log.serial || '---'}
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Collapsible Checklist Menu */}
            <AnimatePresence>
                {isChecklistOpen && techId && (
                    <motion.div 
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 380, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        className="h-full border-l border-gray-100 bg-white overflow-hidden relative shadow-2xl z-30"
                    >
                        <div className="w-[380px] h-full flex flex-col">
                            <div className="p-6 border-b border-gray-50 flex items-center justify-between">
                                <p className="text-sm font-black uppercase tracking-widest text-gray-900">Task Checklist</p>
                                <button onClick={() => setIsChecklistOpen(false)} className="p-2 bg-gray-50 text-gray-400 rounded-xl hover:bg-gray-100">
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto no-scrollbar">
                                <Checklist role="technician" userId={techId} />
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
