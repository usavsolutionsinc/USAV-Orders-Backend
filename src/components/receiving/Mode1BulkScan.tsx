'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Loader2, Package, X } from '@/components/Icons';
import { detectCarrierFromTracking, toDisplayCarrier } from '@/utils/carrier-patterns';

interface ScanEntry {
    id: string;
    tracking: string;
    carrier: string;
    timestamp: string;
    status: 'sending' | 'ok' | 'error';
    errorMsg?: string;
}

interface Mode1BulkScanProps {
    staffId?: string;
    onEntryAdded?: (entry: ScanEntry) => void;
}

let _optimisticId = 0;

export default function Mode1BulkScan({ staffId, onEntryAdded }: Mode1BulkScanProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [trackingInput, setTrackingInput] = useState('');
    const [recentScans, setRecentScans] = useState<ScanEntry[]>([]);
    const [sessionCount, setSessionCount] = useState(0);

    useEffect(() => {
        inputRef.current?.focus();
        const handleFocus = () => requestAnimationFrame(() => inputRef.current?.focus());
        window.addEventListener('receiving-focus-scan', handleFocus);
        return () => window.removeEventListener('receiving-focus-scan', handleFocus);
    }, []);

    // Keep count synced when entries arrive from sidebar
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (!detail || typeof detail !== 'object') return;
            const entry: ScanEntry = {
                id: String(detail.id || Date.now()),
                tracking: detail.receiving_tracking_number || detail.tracking || '',
                carrier: detail.carrier || 'Unknown',
                timestamp: detail.timestamp || new Date().toISOString(),
                status: 'ok',
            };
            setRecentScans((prev) => [entry, ...prev].slice(0, 30));
            setSessionCount((c) => c + 1);
        };
        window.addEventListener('receiving-entry-added', handler);
        return () => window.removeEventListener('receiving-entry-added', handler);
    }, []);

    const handleScan = useCallback(() => {
        const tracking = trackingInput.trim();
        if (!tracking) return;

        // ── Optimistic: update UI instantly ──
        const carrier = toDisplayCarrier(detectCarrierFromTracking(tracking));
        const tempId = `opt_${++_optimisticId}`;
        const optimisticEntry: ScanEntry = {
            id: tempId,
            tracking,
            carrier,
            timestamp: new Date().toISOString(),
            status: 'sending',
        };

        setTrackingInput('');
        setRecentScans((prev) => [optimisticEntry, ...prev].slice(0, 30));
        setSessionCount((c) => c + 1);
        requestAnimationFrame(() => inputRef.current?.focus());

        // ── Fire POST in background — don't block input ──
        fetch('/api/receiving-entry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                trackingNumber: tracking,
                qaStatus: 'PENDING',
                dispositionCode: 'HOLD',
                conditionGrade: 'BRAND_NEW',
                isReturn: false,
                skipZohoMatch: true,
            }),
        })
            .then(async (res) => {
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err?.error || `HTTP ${res.status}`);
                }
                return res.json();
            })
            .then((data) => {
                // Reconcile optimistic entry with server response
                const serverEntry: ScanEntry = {
                    id: String(data.record?.id || tempId),
                    tracking,
                    carrier: data.record?.status || carrier,
                    timestamp: data.record?.timestamp || optimisticEntry.timestamp,
                    status: 'ok',
                };
                setRecentScans((prev) =>
                    prev.map((e) => (e.id === tempId ? serverEntry : e)),
                );
                if (data.record) {
                    window.dispatchEvent(new CustomEvent('receiving-entry-added', { detail: data.record }));
                }
                onEntryAdded?.(serverEntry);
            })
            .catch((err: Error) => {
                // Mark as failed but keep in list
                setRecentScans((prev) =>
                    prev.map((e) =>
                        e.id === tempId
                            ? { ...e, status: 'error', errorMsg: err.message || 'Failed' }
                            : e,
                    ),
                );
            });
    }, [trackingInput, onEntryAdded]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleScan();
        }
    };

    const dismissError = (id: string) => {
        setRecentScans((prev) => prev.filter((e) => e.id !== id));
        setSessionCount((c) => Math.max(0, c - 1));
    };

    return (
        <div className="flex h-full flex-col bg-white overflow-hidden">
            {/* Compact header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                <p className="text-[10px] font-black uppercase tracking-[0.15em] text-gray-400">Bulk Scan</p>
                <motion.span
                    key={sessionCount}
                    initial={{ scale: 1.3, color: '#3b82f6' }}
                    animate={{ scale: 1, color: '#6b7280' }}
                    transition={{ type: 'spring', damping: 14, stiffness: 300 }}
                    className="text-sm font-black tabular-nums text-gray-500"
                >
                    {sessionCount}
                </motion.span>
            </div>

            {/* Scan input — always enabled, never blocks */}
            <div className="px-4 py-3 border-b border-gray-100">
                <div className="relative">
                    <input
                        ref={inputRef}
                        type="text"
                        value={trackingInput}
                        onChange={(e) => setTrackingInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Scan tracking number..."
                        className="w-full rounded-xl bg-gray-50 px-4 py-3 pr-12 text-sm font-mono font-semibold text-gray-900 outline-none ring-1 ring-gray-200 transition-shadow focus:ring-2 focus:ring-blue-500 focus:bg-white placeholder:font-normal placeholder:text-gray-400"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                    {trackingInput.trim() && (
                        <button
                            type="button"
                            onClick={handleScan}
                            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                        >
                            <Check className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            </div>

            {/* Scan feed */}
            <div className="flex-1 overflow-y-auto">
                {recentScans.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center opacity-40">
                        <Package className="mb-2 h-8 w-8" />
                        <p className="text-[10px] font-bold uppercase tracking-widest">Ready to scan</p>
                    </div>
                ) : (
                    <ul>
                        <AnimatePresence initial={false}>
                            {recentScans.map((entry) => (
                                <motion.li
                                    key={entry.id}
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.15 }}
                                    className="border-b border-gray-50"
                                >
                                    <div className="flex items-center gap-3 px-4 py-2.5">
                                        {/* Status indicator */}
                                        <div className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${
                                            entry.status === 'ok' ? 'bg-emerald-50' :
                                            entry.status === 'error' ? 'bg-red-50' :
                                            'bg-blue-50'
                                        }`}>
                                            {entry.status === 'sending' ? (
                                                <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                                            ) : entry.status === 'error' ? (
                                                <X className="h-3 w-3 text-red-500" />
                                            ) : (
                                                <Check className="h-3 w-3 text-emerald-500" />
                                            )}
                                        </div>

                                        {/* Tracking info */}
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate font-mono text-[11px] font-bold text-gray-800">
                                                {entry.tracking}
                                            </p>
                                            {entry.status === 'error' ? (
                                                <p className="text-[10px] font-semibold text-red-500">{entry.errorMsg}</p>
                                            ) : (
                                                <p className="text-[10px] font-medium text-gray-400">{entry.carrier}</p>
                                            )}
                                        </div>

                                        {/* Dismiss failed entries */}
                                        {entry.status === 'error' && (
                                            <button
                                                type="button"
                                                onClick={() => dismissError(entry.id)}
                                                className="flex-shrink-0 rounded-md p-1 text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        )}
                                    </div>
                                </motion.li>
                            ))}
                        </AnimatePresence>
                    </ul>
                )}
            </div>
        </div>
    );
}
