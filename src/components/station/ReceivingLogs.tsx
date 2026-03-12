'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Loader2, Copy, Check } from '../Icons';
import { motion } from 'framer-motion';
import { formatDateWithOrdinal, getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { DateGroupHeader } from '@/components/shipped/DateGroupHeader';
import WeekHeader from '@/components/ui/WeekHeader';
import { useAblyChannel } from '@/hooks/useAblyChannel';

const STATION_CHANNEL =
  process.env.NEXT_PUBLIC_ABLY_CHANNEL_STATION_CHANGES || 'station:changes';

interface ReceivingLog {
    id: string;
    timestamp: string;
    tracking?: string;
    status?: string;
    count?: number;
    qa_status?: string | null;
    disposition_code?: string | null;
    condition_grade?: string | null;
    is_return?: boolean;
    return_platform?: string | null;
    return_reason?: string | null;
    needs_test?: boolean;
    assigned_tech_id?: number | null;
    target_channel?: string | null;
    received_at?: string | null;
    received_by?: number | null;
    unboxed_at?: string | null;
    unboxed_by?: number | null;
    zoho_purchase_receive_id?: string | null;
    zoho_warehouse_id?: string | null;
}

interface ReceivingLogsProps {
    onSelectLog?: (log: ReceivingLog) => void;
    selectedLogId?: string | null;
}

function formatDbTime(value: string | null | undefined): string {
    if (!value) return '--:--';

    const raw = String(value).trim();
    if (!raw) return '--:--';

    // Handles ISO strings like "2026-03-09T13:25:19.000Z" and plain "2026-03-09 13:25:19"
    const match = raw.match(/(?:T|\s)(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/);
    if (match) return `${match[1]}:${match[2]}`;

    return '--:--';
}

function computeWeekRange(weekOffset: number) {
    const todayPst = getCurrentPSTDateKey();
    const [pstYear, pstMonth, pstDay] = todayPst.split('-').map(Number);
    const now = new Date(pstYear, (pstMonth || 1) - 1, pstDay || 1);
    const dayOfWeek = now.getDay();
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysFromMonday - weekOffset * 7);
    monday.setHours(0, 0, 0, 0);
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    friday.setHours(23, 59, 59, 999);
    const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { startStr: fmt(monday), endStr: fmt(friday), start: monday, end: friday };
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

export default function ReceivingLogs({ onSelectLog, selectedLogId }: ReceivingLogsProps) {
    const queryClient = useQueryClient();
    const [weekOffset, setWeekOffset] = useState(0);
    const [stickyDate, setStickyDate] = useState('');
    const [currentCount, setCurrentCount] = useState(0);
    const scrollRef = useRef<HTMLDivElement>(null);

    const weekRange = computeWeekRange(weekOffset);
    const queryKey = ['receiving-logs', { weekStart: weekRange.startStr, weekEnd: weekRange.endStr }] as const;

    const { data = [], isLoading, isFetching } = useQuery<ReceivingLog[]>({
        queryKey,
        queryFn: async () => {
            const params = new URLSearchParams({
                weekStart: weekRange.startStr,
                weekEnd: weekRange.endStr,
                limit: '500',
            });
            // Bypass browser HTTP cache so invalidateQueries always gets fresh data
            // from the server (server-side Upstash Redis handles the DB caching).
            const res = await fetch(`/api/receiving-logs?${params}`, { cache: 'no-store' });
            if (!res.ok) throw new Error('Failed to fetch receiving logs');
            const json = await res.json();
            return Array.isArray(json) ? json : [];
        },
        // Current week: 30 s (same as server TTL so new scans appear fast).
        // Past weeks: 30 min (server caches for 24 h, navigating back is instant).
        staleTime: weekOffset === 0 ? 30 * 1000 : 30 * 60 * 1000,
        gcTime: 24 * 60 * 60 * 1000,
        placeholderData: (prev) => prev,
        refetchOnWindowFocus: false,
    });

    // Surgical insert: prepend the single new record without any network request.
    // The server already updated its Redis cache entry for this week, so the
    // TanStack Query cache and server are kept in sync without a full re-fetch.
    useEffect(() => {
        const handleNewEntry = (e: any) => {
            const record = e?.detail as ReceivingLog | null;
            if (!record?.id) return;

            // Target the current week's cache key (new entries are always "now").
            const currentWeek = computeWeekRange(0);
            queryClient.setQueryData<ReceivingLog[]>(
                ['receiving-logs', { weekStart: currentWeek.startStr, weekEnd: currentWeek.endStr }],
                (prev) => {
                    if (!prev) return undefined; // cache not yet populated — skip
                    if (prev.some((r) => r.id === record.id)) return prev; // dedup
                    return [record, ...prev];
                },
            );
        };
        window.addEventListener('receiving-entry-added', handleNewEntry);
        return () => window.removeEventListener('receiving-entry-added', handleNewEntry);
    }, [queryClient]);

    // Full invalidation for edits, deletes, and any other external data changes.
    // New entries are handled above via setQueryData so they skip this path.
    useEffect(() => {
        const handleRefresh = () => {
            queryClient.invalidateQueries({ queryKey: ['receiving-logs'] });
        };
        window.addEventListener('usav-refresh-data', handleRefresh);
        return () => window.removeEventListener('usav-refresh-data', handleRefresh);
    }, [queryClient]);

    // Ably: cross-session live updates (mobile or other browser tabs).
    useAblyChannel(
        STATION_CHANNEL,
        'receiving-log.changed',
        (msg: any) => {
            const { action, row } = msg?.data ?? {};
            if (action === 'insert' && row) {
                const currentWeek = computeWeekRange(0);
                queryClient.setQueryData<ReceivingLog[]>(
                    ['receiving-logs', { weekStart: currentWeek.startStr, weekEnd: currentWeek.endStr }],
                    (prev) => {
                        if (!prev) return undefined;
                        if (prev.some((r) => r.id === (row as ReceivingLog).id)) return prev;
                        return [row as ReceivingLog, ...prev];
                    },
                );
            } else {
                queryClient.invalidateQueries({ queryKey: ['receiving-logs'] });
            }
        },
    );

    const formatDate = (dateStr: string) => formatDateWithOrdinal(dateStr);

    // Group by PST date and apply precise week filter (server has ±1 day UTC buffer).
    const grouped: { [key: string]: ReceivingLog[] } = {};
    data.forEach(log => {
        if (!log.timestamp) return;
        let date = '';
        try { date = toPSTDateKey(log.timestamp) || 'Unknown'; } catch { date = 'Unknown'; }
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push({
            ...log,
            count: typeof log.count === 'number' ? log.count : parseInt(String(log.count || '1')) || 0,
        });
    });

    const weekGrouped = Object.fromEntries(
        Object.entries(grouped).filter(([date]) => date >= weekRange.startStr && date <= weekRange.endStr)
    );

    const sortedEntries = Object.entries(weekGrouped).sort((a, b) => b[0].localeCompare(a[0]));
    const groupedTotals: { [key: string]: number } = {};
    for (const [date, logs] of sortedEntries) {
        groupedTotals[date] = logs.reduce((s, l) => s + (Number(l.count) || 0), 0);
    }
    const getWeekCount = () => Object.values(groupedTotals).reduce((s, c) => s + c, 0);

    const handleScroll = useCallback(() => {
        if (!scrollRef.current) return;
        const { scrollTop } = scrollRef.current;
        const headers = scrollRef.current.querySelectorAll('[data-day-header]');
        let activeDate = '';
        let activeCount = 0;
        for (let i = 0; i < headers.length; i++) {
            const header = headers[i] as HTMLElement;
            if (header.offsetTop - scrollRef.current.offsetTop <= scrollTop + 5) {
                activeDate = header.getAttribute('data-date') || '';
                activeCount = parseInt(header.getAttribute('data-count') || '0');
            } else break;
        }
        if (activeDate) setStickyDate(formatDate(activeDate));
        if (activeCount) setCurrentCount(activeCount);
    }, []);

    useEffect(() => {
        const container = scrollRef.current;
        if (container) {
            container.addEventListener('scroll', handleScroll);
            setTimeout(() => handleScroll(), 100);
        }
        return () => container?.removeEventListener('scroll', handleScroll);
    }, [handleScroll, data]);

    return (
        <div className="flex flex-col h-full w-full bg-white relative overflow-hidden">
            <WeekHeader
                stickyDate={stickyDate}
                fallbackDate={sortedEntries.length > 0 ? formatDate(sortedEntries[0][0]) : formatDate(getCurrentPSTDateKey())}
                count={currentCount || getWeekCount()}
                countClassName="text-blue-600"
                weekRange={weekRange}
                weekOffset={weekOffset}
                onPrevWeek={() => setWeekOffset(weekOffset + 1)}
                onNextWeek={() => setWeekOffset(Math.max(0, weekOffset - 1))}
                formatDate={formatDate}
                rightSlot={
                    isFetching && !isLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                    ) : null
                }
            />

            <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar w-full">
                {isLoading && data.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-40 gap-3 text-gray-400">
                        <Loader2 className="w-8 h-8 animate-spin" />
                        <p className="text-[10px] font-black uppercase tracking-widest">Loading Records...</p>
                    </div>
                ) : sortedEntries.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-40 text-center opacity-20">
                        <Package className="w-16 h-16 mb-4" />
                        <p className="text-[10px] font-black uppercase tracking-widest">No Logs Found</p>
                    </div>
                ) : (
                    <div className="flex flex-col">
                        {sortedEntries.map(([date, logs]) => (
                            <div key={date} className="flex flex-col">
                                <DateGroupHeader date={date} total={groupedTotals[date] || 0} formatDate={formatDate} />
                                {logs.map((log, index) => (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        key={log.id}
                                        onClick={() => onSelectLog?.(log)}
                                        className={`grid grid-cols-[45px_1fr] items-center gap-2 px-2 py-1 transition-colors border-b border-gray-50/50 cursor-pointer hover:bg-blue-50/40 ${
                                            selectedLogId === log.id ? 'bg-blue-50/60' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/20'
                                        }`}
                                    >
                                        <div className="text-[11px] font-black text-gray-400 tabular-nums uppercase text-left">
                                            {formatDbTime(log.timestamp)}
                                        </div>
                                        <div className="flex items-center gap-2 min-w-0">
                                            <CopyableText
                                                text={log.tracking || ''}
                                                className="text-[11px] font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 w-[60px]"
                                            />
                                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest opacity-60 truncate">
                                                {log.status || 'Unknown'}
                                            </span>
                                            {log.is_return ? (
                                                <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-amber-700">
                                                    Return
                                                </span>
                                            ) : null}
                                            {log.needs_test ? (
                                                <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-slate-600">
                                                    Test
                                                </span>
                                            ) : null}
                                            {String(log.target_channel || '').toUpperCase() === 'FBA' ? (
                                                <span className="rounded border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-purple-700">
                                                    FBA
                                                </span>
                                            ) : null}
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
