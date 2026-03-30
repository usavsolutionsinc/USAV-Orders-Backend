'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Barcode, Check, Loader2, Package, X } from '@/components/Icons';
import { formatTimePST } from '@/utils/date';
import { invalidateReceivingCache } from '@/lib/receivingCache';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

interface ScanEntry {
    id: string;
    tracking: string;
    carrier: string;
    timestamp: string;
    zohoLinked?: boolean;
    isLocal?: boolean;
}

interface Mode1BulkScanProps {
    staffId?: string;
    onEntryAdded?: (entry: ScanEntry) => void;
}

export default function Mode1BulkScan({ staffId, onEntryAdded }: Mode1BulkScanProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [trackingInput, setTrackingInput] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [recentScans, setRecentScans] = useState<ScanEntry[]>([]);
    const [flashSuccess, setFlashSuccess] = useState(false);
    const [flashError, setFlashError] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [sessionCount, setSessionCount] = useState(0);

    useEffect(() => {
        inputRef.current?.focus();

        const handleFocus = () => {
            requestAnimationFrame(() => inputRef.current?.focus());
        };
        window.addEventListener('receiving-focus-scan', handleFocus);
        return () => window.removeEventListener('receiving-focus-scan', handleFocus);
    }, []);

    // Listen for entries added from other sources (e.g. sidebar) to keep count synced
    useEffect(() => {
        const handleEntryAdded = (e: Event) => {
            const custom = e as CustomEvent;
            if (custom.detail && typeof custom.detail === 'object') {
                const entry: ScanEntry = {
                    id: String(custom.detail.id || Date.now()),
                    tracking: custom.detail.receiving_tracking_number || custom.detail.tracking || '',
                    carrier: custom.detail.carrier || 'Unknown',
                    timestamp: custom.detail.timestamp || new Date().toISOString(),
                };
                setRecentScans((prev) => [entry, ...prev].slice(0, 20));
            }
        };
        window.addEventListener('receiving-entry-added', handleEntryAdded);
        return () => window.removeEventListener('receiving-entry-added', handleEntryAdded);
    }, []);

    const triggerSuccessFlash = () => {
        setFlashSuccess(true);
        setTimeout(() => setFlashSuccess(false), 600);
    };

    const triggerErrorFlash = (msg: string) => {
        setFlashError(true);
        setErrorMsg(msg);
        setTimeout(() => {
            setFlashError(false);
            setErrorMsg(null);
        }, 2500);
    };

    const handleScan = useCallback(async () => {
        const tracking = trackingInput.trim();
        if (!tracking || isSubmitting) return;

        setIsSubmitting(true);
        setTrackingInput('');

        try {
            const res = await fetch('/api/receiving-entry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trackingNumber: tracking,
                    qaStatus: 'PENDING',
                    dispositionCode: 'HOLD',
                    conditionGrade: 'BRAND_NEW',
                    isReturn: false,
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err?.error || `HTTP ${res.status}`);
            }

            const data = await res.json();
            const newEntry: ScanEntry = {
                id: String(data.record?.id || Date.now()),
                tracking,
                carrier: data.record?.carrier || 'Unknown',
                timestamp: data.record?.timestamp || new Date().toISOString(),
            };

            setRecentScans((prev) => [newEntry, ...prev].slice(0, 20));
            setSessionCount((c) => c + 1);
            triggerSuccessFlash();
            invalidateReceivingCache();

            if (data.record) {
                window.dispatchEvent(new CustomEvent('receiving-entry-added', { detail: data.record }));
            }

            onEntryAdded?.(newEntry);

            // Silent background Zoho enrichment — fire and forget
            if (data.record?.id) {
                enrichWithZoho(tracking, Number(data.record.id));
            }
        } catch (err: any) {
            triggerErrorFlash(err?.message || 'Scan failed');
        } finally {
            setIsSubmitting(false);
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [trackingInput, isSubmitting, onEntryAdded]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleScan();
        }
    };

    return (
        <div className="flex h-full flex-col bg-white overflow-hidden">
            {/* Flash overlay */}
            <AnimatePresence>
                {(flashSuccess || flashError) && (
                    <motion.div
                        key={flashSuccess ? 'success' : 'error'}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.12 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className={`pointer-events-none fixed inset-0 z-50 ${flashSuccess ? 'bg-emerald-400' : 'bg-red-400'}`}
                    />
                )}
            </AnimatePresence>

            {/* Header */}
            <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600">
                            <Barcode className="h-5 w-5 text-white" />
                        </div>
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-500">Mode 1</p>
                            <h2 className="text-lg font-black uppercase tracking-tight text-gray-900 leading-none">Bulk Scan</h2>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">Session</p>
                        <motion.p
                            key={sessionCount}
                            initial={{ scale: 1.4, color: '#2563eb' }}
                            animate={{ scale: 1, color: '#111827' }}
                            transition={{ type: 'spring', damping: 12, stiffness: 300 }}
                            className="text-3xl font-black tabular-nums"
                        >
                            {sessionCount}
                        </motion.p>
                    </div>
                </div>
            </div>

            {/* Scan input */}
            <div className="border-b border-gray-200 bg-white p-4">
                <div className={`relative rounded-2xl transition-all duration-150 ${
                    flashError ? 'ring-2 ring-red-400' : flashSuccess ? 'ring-2 ring-emerald-400' : 'ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-blue-500'
                }`}>
                    <input
                        ref={inputRef}
                        type="text"
                        value={trackingInput}
                        onChange={(e) => setTrackingInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Scan or enter tracking number..."
                        className="w-full rounded-2xl bg-white px-4 py-4 pr-14 text-sm font-mono font-bold text-gray-900 outline-none placeholder:font-normal placeholder:text-gray-400"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        disabled={isSubmitting}
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        {isSubmitting ? (
                            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                        ) : trackingInput.trim() ? (
                            <button
                                type="button"
                                onClick={handleScan}
                                className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                            >
                                <Check className="h-4 w-4" />
                            </button>
                        ) : (
                            <Package className="h-5 w-5 text-gray-500" />
                        )}
                    </div>
                </div>

                {errorMsg && (
                    <motion.p
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="mt-2 text-[11px] font-bold text-red-600"
                    >
                        {errorMsg}
                    </motion.p>
                )}

                <p className="mt-2 text-center text-[10px] font-bold uppercase tracking-widest text-gray-500">
                    Press Enter or scan to log — classification happens in Unboxing
                </p>
            </div>

            {/* Recent scans */}
            <div className="flex-1 overflow-y-auto">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white/90 px-4 py-2 backdrop-blur-sm">
                    <p className={sectionLabel}>Recent Scans</p>
                    {recentScans.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setRecentScans([])}
                            className="text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-600"
                        >
                            Clear
                        </button>
                    )}
                </div>

                {recentScans.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <Package className="mb-3 h-10 w-10 text-gray-200" />
                        <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">No scans yet</p>
                        <p className="mt-1 text-[10px] font-semibold text-gray-500">Scan a tracking number to begin</p>
                    </div>
                ) : (
                    <ul className="divide-y divide-gray-50">
                        <AnimatePresence initial={false}>
                            {recentScans.map((entry, index) => (
                                <motion.li
                                    key={entry.id}
                                    initial={{ opacity: 0, x: -16, backgroundColor: '#dbeafe' }}
                                    animate={{ opacity: 1, x: 0, backgroundColor: '#ffffff' }}
                                    transition={{ delay: index === 0 ? 0 : 0, duration: 0.25 }}
                                    className="flex items-center gap-3 px-4 py-3"
                                >
                                    <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl ${
                                        entry.zohoLinked ? 'bg-emerald-100' : 'bg-gray-100'
                                    }`}>
                                        {entry.zohoLinked ? (
                                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                                        ) : (
                                            <Package className="h-3.5 w-3.5 text-gray-400" />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate font-mono text-[11px] font-bold text-gray-900">
                                            {entry.tracking}
                                        </p>
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                                            {entry.carrier} · {formatTimePST(entry.timestamp)}
                                        </p>
                                    </div>
                                    <span className="flex-shrink-0 rounded-lg bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-700">
                                        Pending
                                    </span>
                                </motion.li>
                            ))}
                        </AnimatePresence>
                    </ul>
                )}
            </div>
        </div>
    );
}

/**
 * Fire-and-forget: after a successful scan, look up Zoho to see if this tracking
 * matches an open purchase receive and, if so, PATCH the entry to enrich it.
 */
async function enrichWithZoho(tracking: string, receivingId: number) {
    try {
        const res = await fetch(`/api/zoho/purchase-receives?tracking=${encodeURIComponent(tracking)}`, {
           
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!data.found || !data.purchasereceives?.[0]) return;

        const pr = data.purchasereceives[0];
        await fetch('/api/receiving-logs', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: receivingId,
                zoho_purchase_receive_id: pr.purchase_receive_id,
                zoho_warehouse_id: pr.warehouse_id || null,
            }),
        });
    } catch {
        // Non-fatal — Zoho enrichment is best-effort
    }
}
