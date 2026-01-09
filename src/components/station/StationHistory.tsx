'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Package, Loader2, List, ChevronRight, Copy, Check } from '../Icons';
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
    onLoadMore?: (offset: number) => void;
    hasMore?: boolean;
}

const CopyableText = ({ text, className }: { text: string; className?: string }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!text) return;
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Shorten tracking/serial for display - show last digits if long
    const displayText = text.length > 8 ? `...${text.slice(-6)}` : text;

    return (
        <button 
            onClick={handleCopy}
            className={`${className} group relative flex items-center justify-between gap-1 hover:brightness-95 active:scale-95 transition-all w-full`}
            title={`Click to copy: ${text}`}
        >
            <span className="truncate flex-1 text-left">{displayText}</span>
            {copied ? <Check className="w-2 h-2" /> : <Copy className="w-2 h-2 opacity-0 group-hover:opacity-40 transition-opacity" />}
        </button>
    );
};

export default function StationHistory({ 
    history: initialHistory, 
    isLoading: isInitialLoading, 
    techId, 
    stationType 
}: StationHistoryProps) {
    const [history, setHistory] = useState<HistoryLog[]>(initialHistory);
    const [isChecklistOpen, setIsChecklistOpen] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [offset, setOffset] = useState(0);
    const [stickyDate, setStickyDate] = useState<string>('');
    const [currentCount, setCurrentCount] = useState<number>(0);
    const scrollRef = useRef<HTMLDivElement>(null);
    const limit = 50;

    useEffect(() => {
        setHistory(initialHistory);
        setOffset(0);
        setHasMore(true);
    }, [initialHistory]);

    const loadMore = useCallback(async () => {
        if (isLoadingMore || !hasMore || !techId) return;
        
        setIsLoadingMore(true);
        try {
            const nextOffset = offset + limit;
            const res = await fetch(`/api/tech-logs?techId=${techId}&limit=${limit}&offset=${nextOffset}`);
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json();
            
            if (data.length < limit) setHasMore(false);
            if (data.length > 0) {
                setHistory(prev => [...prev, ...data]);
                setOffset(nextOffset);
            } else {
                setHasMore(false);
            }
        } catch (err) {
            console.error("Failed to load more:", err);
        } finally {
            setIsLoadingMore(false);
        }
    }, [offset, hasMore, isLoadingMore, techId]);

    const formatDate = (dateStr: string) => {
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        } catch (e) { return dateStr; }
    };

    const handleScroll = useCallback(() => {
        if (!scrollRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
        
        // Infinite scroll check
        if (scrollHeight - scrollTop <= clientHeight + 100) {
            loadMore();
        }

        // Sticky header check
        const items = scrollRef.current.querySelectorAll('[data-date]');
        let visibleDate = '';
        let visibleCount = 0;

        for (let i = 0; i < items.length; i++) {
            const item = items[i] as HTMLElement;
            if (item.offsetTop - scrollRef.current.offsetTop <= scrollTop + 100) {
                visibleDate = item.getAttribute('data-date') || '';
                visibleCount = parseInt(item.getAttribute('data-count') || '0');
            }
        }

        if (visibleDate) setStickyDate(formatDate(visibleDate));
        if (visibleCount) setCurrentCount(visibleCount);
    }, [loadMore]);

    useEffect(() => {
        const container = scrollRef.current;
        if (container) {
            container.addEventListener('scroll', handleScroll);
            handleScroll();
        }
        return () => container?.removeEventListener('scroll', handleScroll);
    }, [handleScroll, history]);

    // Group history by day
    const groupedHistory: { [key: string]: HistoryLog[] } = {};
    history.forEach(log => {
        // Handle different property names from different APIs
        const timestamp = log.timestamp || (log as any).packedAt;
        if (!timestamp) return;
        
        const date = timestamp.split('T')[0];
        if (!groupedHistory[date]) groupedHistory[date] = [];
        
        // Normalize for display
        const normalizedLog = {
            ...log,
            timestamp,
            title: log.title || (log as any).product || 'Unknown Product',
            tracking: log.tracking || (log as any).trackingNumber || '',
            status: log.status || (log as any).carrier || ''
        };
        
        groupedHistory[date].push(normalizedLog);
    });

    return (
        <div className="flex flex-col h-full w-full bg-white relative overflow-hidden">
            {/* Sticky Header */}
            <div className="flex-shrink-0 z-20 bg-white/95 backdrop-blur-md border-b border-gray-100 px-2 py-1 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-2">
                    <p className="text-[9px] font-black text-gray-900 tracking-tight">
                        {stickyDate || (history.length > 0 ? formatDate(history[0].timestamp || (history[0] as any).packedAt) : 'Today')}
                    </p>
                    <div className="h-2 w-px bg-gray-200" />
                    <p className="text-[8px] font-black text-blue-600 uppercase tracking-widest">
                        Count: {currentCount || (history.length > 0 ? history[0].count : 0)}
                    </p>
                </div>
                
                {techId && (
                    <button 
                        onClick={() => setIsChecklistOpen(!isChecklistOpen)}
                        className={`p-1 rounded-lg transition-all ${isChecklistOpen ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
                    >
                        <List className="w-3 h-3" />
                    </button>
                )}
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar w-full">
                {isInitialLoading ? (
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
                    <div className="flex flex-col">
                        {Object.entries(groupedHistory).map(([date, logs]) => (
                            <div key={date} className="flex flex-col">
                                {/* Day Header Bar */}
                                <div className="bg-gray-50/80 border-y border-gray-100 px-2 py-0.5 flex items-center justify-between sticky top-0 z-10 h-[18px]">
                                    <p className="text-[6px] font-black text-gray-900 uppercase tracking-widest">{formatDate(date)}</p>
                                    <p className="text-[6px] font-black text-gray-400 uppercase">Total: {logs[0]?.count || logs.length} Units</p>
                                </div>
                                {logs.map((log, index) => {
                                    const ts = log.timestamp || (log as any).packedAt;
                                    return (
                                        <motion.div 
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            key={log.id} 
                                            data-date={date}
                                            data-count={log.count || logs.length - index}
                                            className={`grid grid-cols-[45px_1fr_50px_70px_70px] items-center gap-1 px-1 py-0.5 transition-colors border-b border-gray-50/50 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/20'}`}
                                        >
                                            <div className="text-[8px] font-black text-gray-400 tabular-nums uppercase text-left">
                                                {ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).replace(/\s?[APM]{2}$/, '') : '--:--'}
                                            </div>
                                            <div className="text-[9px] font-bold text-gray-900 truncate text-left">
                                                {log.title || (log as any).product || 'Unknown Product'}
                                            </div>
                                            <div className="text-[7px] font-black text-gray-400 uppercase tracking-widest text-left truncate opacity-60">
                                                {log.status || (log as any).carrier || '---'}
                                            </div>
                                            <CopyableText 
                                                text={log.tracking || (log as any).trackingNumber || ''} 
                                                className="text-[9px] font-mono font-bold text-blue-600 bg-blue-50/30 px-1 py-0.5 rounded border border-blue-100/30" 
                                            />
                                            <CopyableText 
                                                text={log.serial || ''} 
                                                className="text-[9px] font-mono font-bold text-emerald-600 bg-emerald-50/30 px-1 py-0.5 rounded border border-emerald-100/30" 
                                            />
                                        </motion.div>
                                    );
                                })}
                            </div>
                        ))}
                        
                        {isLoadingMore && (
                            <div className="py-8 flex justify-center">
                                <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
                            </div>
                        )}
                    </div>
                )}
            </div>

            <AnimatePresence>
                {isChecklistOpen && techId && (
                    <>
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsChecklistOpen(false)}
                            className="absolute inset-0 bg-black/10 backdrop-blur-[2px] z-30"
                        />
                        <motion.div 
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '100%' }}
                            transition={{ type: "spring", damping: 25, stiffness: 200 }}
                            className="absolute top-0 right-0 h-full bg-white w-[400px] shadow-[-20px_0_50px_rgba(0,0,0,0.1)] z-40 flex flex-col border-l border-gray-100"
                        >
                            <div className="p-6 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
                                <p className="text-sm font-black uppercase tracking-widest text-gray-900">Task Checklist</p>
                                <button onClick={() => setIsChecklistOpen(false)} className="p-2 bg-white text-gray-400 rounded-xl hover:bg-gray-100 transition-colors shadow-sm">
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
