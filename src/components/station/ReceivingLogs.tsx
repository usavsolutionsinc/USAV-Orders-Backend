'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Loader2, Search } from '../Icons';
import { CopyChip, getLast4 } from '@/components/ui/CopyChip';
import { AnimatePresence, motion } from 'framer-motion';
import { formatDateWithOrdinal, getCurrentPSTDateKey, toPSTDateKey, computeWeekRange } from '@/utils/date';
import { DateGroupHeader } from '@/components/shipped/DateGroupHeader';
import WeekHeader from '@/components/ui/WeekHeader';
import { OverlaySearchBar } from '@/components/ui/OverlaySearchBar';
import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { useAblyChannel } from '@/hooks/useAblyChannel';
import { getStationChannelName } from '@/lib/realtime/channels';

const STATION_CHANNEL = getStationChannelName();

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

type ReceivingLogFilter = 'all' | 'fba' | 'returns';

function formatDbTime(value: string | null | undefined): string {
    if (!value) return '--:--';

    const raw = String(value).trim();
    if (!raw) return '--:--';

    // Handles ISO strings like "2026-03-09T13:25:19.000Z" and plain "2026-03-09 13:25:19"
    const match = raw.match(/(?:T|\s)(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/);
    if (match) return `${match[1]}:${match[2]}`;

    return '--:--';
}


export default function ReceivingLogs({ onSelectLog, selectedLogId }: ReceivingLogsProps) {
    const queryClient = useQueryClient();
    const [weekOffset, setWeekOffset] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [logChannelFilter, setLogChannelFilter] = useState<ReceivingLogFilter>('all');
    const [stickyDate, setStickyDate] = useState('');
    const [currentCount, setCurrentCount] = useState(0);
    const scrollRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement | null>(null);

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
            const res = await fetch(`/api/receiving-logs?${params}`);
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

    // ── Surgical cache helpers ──────────────────────────────────────
    // Modify the React Query cache directly so the UI updates instantly
    // without waiting for a network round-trip.
    const currentWeekKey = useMemo(() => {
        const cw = computeWeekRange(0);
        return ['receiving-logs', { weekStart: cw.startStr, weekEnd: cw.endStr }] as const;
    }, []);

    const insertIntoCache = useCallback((record: ReceivingLog) => {
        queryClient.setQueryData<ReceivingLog[]>(currentWeekKey, (prev) => {
            if (!prev) return [record];
            if (prev.some((r) => r.id === record.id)) return prev;
            return [record, ...prev];
        });
    }, [queryClient, currentWeekKey]);

    const removeFromCache = useCallback((id: string) => {
        // Remove from ALL week caches (we don't know which week the entry was in)
        queryClient.setQueriesData<ReceivingLog[]>(
            { queryKey: ['receiving-logs'] },
            (prev) => prev ? prev.filter((r) => r.id !== id) : prev,
        );
    }, [queryClient]);

    // ── Event: new entry added (from Mode1BulkScan or sidebar scan) ──
    useEffect(() => {
        const handler = (e: any) => {
            const record = e?.detail as ReceivingLog | null;
            if (!record?.id) return;
            insertIntoCache(record);
        };
        window.addEventListener('receiving-entry-added', handler);
        return () => window.removeEventListener('receiving-entry-added', handler);
    }, [insertIntoCache]);

    // ── Event: entry deleted ──
    useEffect(() => {
        const handler = (e: any) => {
            const id = String((e as CustomEvent)?.detail ?? '');
            if (id) removeFromCache(id);
        };
        window.addEventListener('receiving-entry-deleted', handler);
        return () => window.removeEventListener('receiving-entry-deleted', handler);
    }, [removeFromCache]);

    // ── Event: generic refresh (edits, external changes) ──
    useEffect(() => {
        const handler = () => {
            queryClient.invalidateQueries({ queryKey: ['receiving-logs'] });
        };
        window.addEventListener('usav-refresh-data', handler);
        return () => window.removeEventListener('usav-refresh-data', handler);
    }, [queryClient]);

    // ── Ably: cross-session live updates (mobile, other tabs) ──
    useAblyChannel(
        STATION_CHANNEL,
        'receiving-log.changed',
        (msg: any) => {
            const { action, rowId, row } = msg?.data ?? {};
            if (action === 'insert' && row) {
                insertIntoCache(row as ReceivingLog);
            } else if (action === 'delete' && rowId) {
                removeFromCache(String(rowId));
            } else {
                queryClient.invalidateQueries({ queryKey: ['receiving-logs'] });
            }
        },
    );

    const formatDate = (dateStr: string) => formatDateWithOrdinal(dateStr);

    const normalizedQuery = searchQuery.trim().toLowerCase();
    const showSearch = searchOpen || Boolean(normalizedQuery);

    const channelFiltered = useMemo(() => {
        if (logChannelFilter === 'fba') {
            return data.filter((log) => String(log.target_channel || '').toUpperCase() === 'FBA');
        }
        if (logChannelFilter === 'returns') {
            return data.filter((log) => log.is_return);
        }
        return data;
    }, [data, logChannelFilter]);

    const logFilterSliderItems = useMemo(
        () => [
            { id: 'all', label: 'All', tone: 'zinc' as const, count: data.length },
            {
                id: 'fba',
                label: 'FBA',
                tone: 'blue' as const,
                count: data.filter((log) => String(log.target_channel || '').toUpperCase() === 'FBA').length,
            },
            { id: 'returns', label: 'Returns', tone: 'yellow' as const, count: data.filter((log) => log.is_return).length },
        ],
        [data]
    );

    const filteredData = normalizedQuery
        ? channelFiltered.filter((log) => {
            const haystack = [
                log.tracking,
                log.status,
                log.return_platform,
                log.return_reason,
                log.target_channel,
            ]
                .map((value) => String(value || '').toLowerCase())
                .join(' ');
            return haystack.includes(normalizedQuery);
        })
        : channelFiltered;

    useEffect(() => {
        if (!showSearch) return;
        const timeoutId = window.setTimeout(() => {
            searchInputRef.current?.focus();
            searchInputRef.current?.select();
        }, 40);
        return () => window.clearTimeout(timeoutId);
    }, [showSearch]);

    const closeSearch = () => {
        setSearchQuery('');
        setSearchOpen(false);
    };

    // Group by PST date and apply precise week filter (server has ±1 day UTC buffer).
    const grouped: { [key: string]: ReceivingLog[] } = {};
    filteredData.forEach(log => {
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
        setStickyDate(activeDate ? formatDate(activeDate) : '');
        setCurrentCount(activeCount);
    }, []);

    useEffect(() => {
        const container = scrollRef.current;
        let timeoutId: number | null = null;
        if (container) {
            container.addEventListener('scroll', handleScroll);
            timeoutId = window.setTimeout(() => handleScroll(), 100);
        }
        return () => {
            container?.removeEventListener('scroll', handleScroll);
            if (timeoutId !== null) window.clearTimeout(timeoutId);
        };
    }, [handleScroll, filteredData]);

    return (
        <div className="flex flex-col h-full w-full bg-white relative overflow-hidden">
            <WeekHeader
                stickyDate={stickyDate}
                fallbackDate={sortedEntries.length > 0 ? formatDate(sortedEntries[0][0]) : formatDate(getCurrentPSTDateKey())}
                count={currentCount || getWeekCount()}
                weekRange={weekRange}
                weekOffset={weekOffset}
                onPrevWeek={() => setWeekOffset(weekOffset + 1)}
                onNextWeek={() => setWeekOffset(Math.max(0, weekOffset - 1))}
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
                                <DateGroupHeader date={date} total={groupedTotals[date] || 0} />
                                {logs.map((log, index) => (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        key={log.id}
                                        onClick={() => onSelectLog?.(log)}
                                        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                                            if (event.target !== event.currentTarget) return;
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                onSelectLog?.(log);
                                            }
                                        }}
                                        role="button"
                                        tabIndex={0}
                                        aria-pressed={selectedLogId === log.id}
                                        aria-label={`Open receiving log ${log.tracking || `#${log.id}`}`}
                                        className={`grid grid-cols-[45px_1fr] items-center gap-2 px-2 py-1 transition-colors border-b border-gray-50/50 cursor-pointer hover:bg-blue-50/40 ${
                                            selectedLogId === log.id ? 'bg-blue-50/60' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/20'
                                        }`}
                                    >
                                        <div className="text-[11px] font-black text-gray-400 tabular-nums uppercase text-left">
                                            {formatDbTime(log.timestamp)}
                                        </div>
                                        <div className="flex items-center gap-2 min-w-0">
                                            <CopyChip
                                                value={log.tracking || ''}
                                                display={getLast4(log.tracking)}
                                                underlineClass="border-blue-500"
                                                truncateDisplay={false}
                                            />
                                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest opacity-60 truncate">
                                                {log.status || 'Unknown'}
                                            </span>
                                            {log.is_return ? (
                                                <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-amber-700">
                                                    Return
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

            <div className="absolute bottom-3 left-3 z-30 flex w-[320px] flex-col gap-2">
                <AnimatePresence initial={false}>
                    {showSearch ? (
                        <motion.div
                            key="receiving-logs-filter"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                        >
                            <div className="rounded-2xl border border-zinc-200/90 bg-white/95 p-2 shadow-md shadow-zinc-900/5 backdrop-blur-sm">
                                <HorizontalButtonSlider
                                    variant="fba"
                                    size="lg"
                                    legend="View"
                                    items={logFilterSliderItems}
                                    value={logChannelFilter}
                                    onChange={(id) => setLogChannelFilter(id as ReceivingLogFilter)}
                                    aria-label="Receiving log filter"
                                />
                            </div>
                        </motion.div>
                    ) : null}
                </AnimatePresence>

                <AnimatePresence initial={false}>
                    {showSearch ? (
                        <motion.div
                            key="receiving-logs-search-bar"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                        >
                            <OverlaySearchBar
                                value={searchQuery}
                                onChange={setSearchQuery}
                                inputRef={searchInputRef}
                                placeholder="Search tracking or carrier..."
                                variant="blue"
                                className="w-full"
                                onClear={closeSearch}
                                onClose={closeSearch}
                            />
                        </motion.div>
                    ) : null}
                </AnimatePresence>

                <AnimatePresence initial={false}>
                    {!showSearch ? (
                        <motion.button
                            key="receiving-logs-search-trigger"
                            type="button"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            whileHover={{ scale: 1.04 }}
                            whileTap={{ scale: 0.96 }}
                            onClick={() => setSearchOpen(true)}
                            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm shadow-blue-600/25 will-change-transform transition hover:bg-blue-500"
                            aria-label="Open receiving logs search"
                        >
                            <Search className="h-4 w-4" />
                        </motion.button>
                    ) : null}
                </AnimatePresence>
            </div>
        </div>
    );
}
