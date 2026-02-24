'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Package, Loader2, Copy, Check } from '../Icons';
import { motion } from 'framer-motion';
import { formatTimePST, toPSTDateKey } from '@/lib/timezone';
import { formatDateWithOrdinal } from '@/lib/date-format';
import { DateGroupHeader } from '@/components/shipped/DateGroupHeader';

interface ReceivingLog {
    id: string;
    timestamp: string;
    tracking?: string;
    status?: string;
    count?: number;
}

interface ReceivingLogsProps {
    history: ReceivingLog[];
    isLoading: boolean;
    onSelectLog?: (log: ReceivingLog) => void;
    selectedLogId?: string | null;
}

const CopyableText = ({ text, className, disabled = false }: { text: string; className?: string; disabled?: boolean }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!text || disabled || text === '---') return;
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const displayText = text.length > 4 ? text.slice(-4) : text;
    const isEmpty = !text || text === '---' || disabled;

    if (isEmpty) {
        return (
            <div className={`${className} flex items-center justify-center w-[60px] opacity-40`}>
                <span className="text-left w-full">---</span>
            </div>
        );
    }

    return (
        <button 
            onClick={handleCopy}
            className={`${className} group relative flex items-center justify-between gap-1 hover:brightness-95 active:scale-95 transition-all w-[60px]`}
            title={`Click to copy: ${text}`}
        >
            <span className="truncate flex-1 text-left">{displayText}</span>
            {copied ? <Check className="w-2 h-2" /> : <Copy className="w-2 h-2 opacity-0 group-hover:opacity-40 transition-opacity" />}
        </button>
    );
};

export default function ReceivingLogs({ 
    history: initialHistory, 
    isLoading: isInitialLoading,
    onSelectLog,
    selectedLogId
}: ReceivingLogsProps) {
    const [history, setHistory] = useState<ReceivingLog[]>(initialHistory);
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
        if (isLoadingMore || !hasMore) return;
        
        setIsLoadingMore(true);
        try {
            const nextOffset = offset + limit;
            const res = await fetch(`/api/receiving-logs?limit=${limit}&offset=${nextOffset}`);
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
    }, [offset, hasMore, isLoadingMore]);

    const formatDate = (dateStr: string) => {
        return formatDateWithOrdinal(dateStr);
    };

    const handleScroll = useCallback(() => {
        if (!scrollRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
        
        if (scrollHeight - scrollTop <= clientHeight + 100) {
            loadMore();
        }

        const headers = scrollRef.current.querySelectorAll('[data-day-header]');
        let activeDate = '';
        let activeCount = 0;

        for (let i = 0; i < headers.length; i++) {
            const header = headers[i] as HTMLElement;
            if (header.offsetTop - scrollRef.current.offsetTop <= scrollTop + 5) {
                activeDate = header.getAttribute('data-date') || '';
                activeCount = parseInt(header.getAttribute('data-count') || '0');
            } else {
                break;
            }
        }

        if (activeDate) {
            setStickyDate(formatDate(activeDate));
            setCurrentCount(activeCount);
        }
    }, [loadMore]);

    useEffect(() => {
        const container = scrollRef.current;
        if (container) {
            container.addEventListener('scroll', handleScroll);
            handleScroll();
        }
        return () => container?.removeEventListener('scroll', handleScroll);
    }, [handleScroll, history]);

    const groupedHistory: { [key: string]: ReceivingLog[] } = {};
    history.forEach(log => {
        const timestamp = log.timestamp;
        if (!timestamp) return;
        
        let date = '';
        try {
            date = toPSTDateKey(timestamp) || '';
        } catch (e) {
            date = '';
        }
        if (!date) date = 'Unknown';
        
        if (!groupedHistory[date]) groupedHistory[date] = [];
        
        const rawCount = log.count; 
        const normalizedLog = {
            ...log,
            timestamp,
            tracking: log.tracking || '',
            status: log.status || '', 
            count: typeof rawCount === 'number' ? rawCount : parseInt(rawCount as any) || 0
        };
        
        groupedHistory[date].push(normalizedLog);
    });

    const sortedGroupedEntries = Object.entries(groupedHistory).sort((a, b) => b[0].localeCompare(a[0]));
    const groupedTotals: { [key: string]: number } = {};
    for (const [date, logs] of sortedGroupedEntries) {
        groupedTotals[date] = logs.reduce((sum, log) => sum + (Number(log.count) || 0), 0);
    }

    return (
        <div className="flex flex-col h-full w-full bg-white relative overflow-hidden">
            <div className="flex-shrink-0 z-20 bg-white/95 backdrop-blur-md border-b border-gray-100 px-2 py-1 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-2">
                    <p className="text-[11px] font-black text-gray-900 tracking-tight">
                        {stickyDate || (sortedGroupedEntries.length > 0 ? formatDate(sortedGroupedEntries[0][0]) : 'Today')}
                    </p>
                    <div className="h-2 w-px bg-gray-200" />
                    <p className="text-[11px] font-black text-blue-600 uppercase tracking-widest">
                        Count: {currentCount || (sortedGroupedEntries.length > 0 ? groupedTotals[sortedGroupedEntries[0][0]] || 0 : 0)}
                    </p>
                </div>
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
                        {sortedGroupedEntries
                            .map(([date, logs]) => (
                            <div key={date} className="flex flex-col">
                                <DateGroupHeader date={date} total={groupedTotals[date] || 0} formatDate={formatDate} />
                                {logs.map((log, index) => {
                                    const ts = log.timestamp;
                                    return (
                                        <motion.div 
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            key={log.id} 
                                            onClick={() => onSelectLog?.(log)}
                                            className={`grid grid-cols-[45px_65px_120px] items-center gap-2 px-2 py-1 transition-colors border-b border-gray-50/50 cursor-pointer hover:bg-blue-50/40 ${
                                                selectedLogId === log.id ? 'bg-blue-50/60' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/20'
                                            }`}
                                        >
                                            <div className="text-[11px] font-black text-gray-400 tabular-nums uppercase text-left">
                                                {ts ? (
                                                    formatTimePST(ts)
                                                ) : '--:--'}
                                            </div>
                                            <div className="flex justify-start">
                                                <CopyableText 
                                                    text={log.tracking || ''} 
                                                    className="text-[11px] font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 w-[110px]" 
                                                />
                                            </div>
                                            <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest text-left opacity-60">
                                                {log.status || 'Unknown'}
                                            </div>
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
        </div>
    );
}
