'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Loader2, Package, Search, X } from '@/components/Icons';
import { invalidateReceivingCache } from '@/lib/receivingCache';
import { getActiveStaff } from '@/lib/staffCache';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

interface SkuStockItem {
    id: number;
    sku: string;
    product_title: string;
    stock: string;
}

interface StaffOption {
    id: number;
    name: string;
    role: string;
}

interface Mode3LocalPickupProps {
    staffId?: string;
}

export default function Mode3LocalPickup({ staffId }: Mode3LocalPickupProps) {
    const searchRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SkuStockItem[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedItem, setSelectedItem] = useState<SkuStockItem | null>(null);
    const [quantity, setQuantity] = useState(1);
    const [receivedBy, setReceivedBy] = useState(staffId || '');
    const [conditionGrade, setConditionGrade] = useState('BRAND_NEW');
    const [staff, setStaff] = useState<StaffOption[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [successEntry, setSuccessEntry] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        getActiveStaff()
            .then((data) => { if (active) setStaff(data); })
            .catch(() => {});
        return () => { active = false; };
    }, []);

    // Keep receivedBy in sync with staffId prop
    useEffect(() => {
        if (staffId && !receivedBy) setReceivedBy(staffId);
    }, [staffId, receivedBy]);

    const handleSearch = async (value: string) => {
        setQuery(value);
        if (!value.trim()) {
            setResults([]);
            return;
        }
        setIsSearching(true);
        try {
            const res = await fetch(`/api/sku-stock?q=${encodeURIComponent(value.trim())}`);
            if (!res.ok) throw new Error('Search failed');
            const data = await res.json();
            const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
            setResults(items.slice(0, 20));
        } catch {
            setResults([]);
        } finally {
            setIsSearching(false);
        }
    };

    const selectItem = (item: SkuStockItem) => {
        setSelectedItem(item);
        setQuantity(1);
        setSuccessEntry(null);
    };

    const handleSubmit = async () => {
        if (!selectedItem || isSubmitting) return;
        setIsSubmitting(true);

        try {
            const syntheticTracking = `LOCAL-${selectedItem.sku || selectedItem.id}-${Date.now()}`;
            const by = Number(receivedBy);

            const res = await fetch('/api/receiving-entry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trackingNumber: syntheticTracking,
                    carrier: 'LOCAL',
                    conditionGrade,
                    qaStatus: 'PASSED',
                    dispositionCode: 'ACCEPT',
                    isReturn: false,
                    targetChannel: 'ORDERS',
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err?.error || `HTTP ${res.status}`);
            }

            const data = await res.json();
            invalidateReceivingCache();

            const receivingId = Number(data?.record?.id);
            if (Number.isFinite(receivingId) && receivingId > 0) {
                await fetch('/api/local-pickups', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        receivingId,
                        productTitle: selectedItem.product_title,
                        sku: selectedItem.sku,
                        quantity,
                        partsStatus: 'COMPLETE',
                        receivingGrade: conditionGrade,
                    }),
                }).catch(() => null);
            }

            if (data.record) {
                window.dispatchEvent(new CustomEvent('receiving-entry-added', { detail: data.record }));
            }
            window.dispatchEvent(new CustomEvent('usav-refresh-data'));

            setSuccessEntry(syntheticTracking);
            setTimeout(() => {
                setSelectedItem(null);
                setSuccessEntry(null);
                setQuery('');
                setResults([]);
                searchRef.current?.focus();
            }, 2000);
        } catch (err: any) {
            alert(err?.message || 'Failed to log local pickup');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-white">
            {/* Header */}
            <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-gray-500">Mode 3</p>
                <h2 className="text-lg font-black uppercase tracking-tight text-gray-900 leading-none">Local Pickup</h2>
                <p className="mt-1 text-[10px] font-semibold text-gray-500">
                    No tracking number — search by product to log a received item
                </p>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Left: search panel */}
                <div className={`flex flex-col border-r border-gray-200 transition-[width] duration-300 ${selectedItem ? 'w-80 flex-shrink-0' : 'flex-1'}`}>
                    <div className="border-b border-gray-100 p-4">
                        <div className="relative rounded-2xl ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-blue-500">
                            <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
                                {isSearching ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                                ) : (
                                    <Search className="h-4 w-4 text-gray-400" />
                                )}
                            </div>
                            <input
                                ref={searchRef}
                                type="text"
                                value={query}
                                onChange={(e) => handleSearch(e.target.value)}
                                placeholder="Search by product title or SKU..."
                                className="w-full rounded-2xl bg-white py-3 pl-9 pr-4 text-sm font-semibold text-gray-900 outline-none placeholder:text-gray-400"
                                autoComplete="off"
                            />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {query && results.length === 0 && !isSearching && (
                            <div className="flex flex-col items-center justify-center py-16 text-center">
                                <Package className="mb-3 h-8 w-8 text-gray-200" />
                                <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">No products found</p>
                            </div>
                        )}

                        {!query && (
                            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                                <Search className="mb-3 h-8 w-8 text-gray-200" />
                                <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">Search Products</p>
                                <p className="mt-1 text-[10px] font-semibold text-gray-500">Type a product name or SKU number</p>
                            </div>
                        )}

                        {results.length > 0 && (
                            <ul className="divide-y divide-gray-50">
                                {results.map((item) => (
                                    <li key={item.id}>
                                        <button
                                            type="button"
                                            onClick={() => selectItem(item)}
                                            className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                                                selectedItem?.id === item.id ? 'bg-blue-50' : ''
                                            }`}
                                        >
                                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gray-100 mt-0.5">
                                                <Package className="h-4 w-4 text-gray-400" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs font-bold text-gray-900 line-clamp-2 leading-tight">
                                                    {item.product_title || '—'}
                                                </p>
                                                <div className="mt-1 flex items-center gap-2">
                                                    <span className="text-[9px] font-mono font-black text-blue-600 uppercase">
                                                        {item.sku || '—'}
                                                    </span>
                                                    <span className="text-[9px] font-bold text-gray-500">
                                                        Stock: {item.stock || '0'}
                                                    </span>
                                                </div>
                                            </div>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>

                {/* Right: item detail + submit */}
                <AnimatePresence>
                    {selectedItem && (
                        <motion.div
                            initial={{ opacity: 0, x: 24 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 24 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="flex flex-1 flex-col overflow-hidden"
                        >
                            {/* Item header */}
                            <div className="flex items-start gap-3 border-b border-gray-200 bg-gray-50 p-4">
                                <button
                                    type="button"
                                    onClick={() => setSelectedItem(null)}
                                    className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
                                >
                                    <X className="h-3.5 w-3.5 text-gray-500" />
                                </button>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-black text-gray-900 leading-tight line-clamp-2">
                                        {selectedItem.product_title}
                                    </p>
                                    <p className="mt-1 font-mono text-[10px] font-bold text-blue-600 uppercase">
                                        SKU: {selectedItem.sku || '—'}
                                    </p>
                                    <p className="text-[10px] font-bold text-gray-500">
                                        Current stock: {selectedItem.stock || '0'}
                                    </p>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                {/* Quantity */}
                                <div>
                                    <p className={sectionLabel + ' mb-2'}>Quantity Received</p>
                                    <div className="flex items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                                            className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 text-lg font-bold transition-colors"
                                        >
                                            −
                                        </button>
                                        <input
                                            type="number"
                                            min={1}
                                            value={quantity}
                                            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                                            className="w-20 rounded-xl border border-gray-200 bg-white py-2 text-center text-lg font-black text-gray-900 outline-none focus:border-blue-500"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setQuantity((q) => q + 1)}
                                            className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 text-lg font-bold transition-colors"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>

                                {/* Condition */}
                                <div>
                                    <p className={sectionLabel + ' mb-2'}>Condition</p>
                                    <select
                                        value={conditionGrade}
                                        onChange={(e) => setConditionGrade(e.target.value)}
                                        className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-gray-900 outline-none focus:border-blue-500"
                                    >
                                        <option value="BRAND_NEW">Brand New</option>
                                        <option value="USED_A">Used — A</option>
                                        <option value="USED_B">Used — B</option>
                                        <option value="USED_C">Used — C</option>
                                        <option value="PARTS">Parts Only</option>
                                    </select>
                                </div>

                                {/* Received by */}
                                <div>
                                    <p className={sectionLabel + ' mb-2'}>Received By</p>
                                    <select
                                        value={receivedBy}
                                        onChange={(e) => setReceivedBy(e.target.value)}
                                        className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-gray-900 outline-none focus:border-blue-500"
                                    >
                                        <option value="">Select Staff</option>
                                        {staff.map((s) => (
                                            <option key={s.id} value={String(s.id)}>{s.name}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Generated ref preview */}
                                <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">Generated Reference</p>
                                    <p className="mt-0.5 font-mono text-[10px] font-bold text-gray-600">
                                        LOCAL-{selectedItem.sku || selectedItem.id}-…
                                    </p>
                                    <p className="mt-0.5 text-[9px] font-semibold text-gray-500">
                                        Auto-generated · Carrier: LOCAL · QA: Passed
                                    </p>
                                </div>
                            </div>

                            <div className="border-t border-gray-200 p-4">
                                <button
                                    type="button"
                                    onClick={handleSubmit}
                                    disabled={isSubmitting || !!successEntry}
                                    className={`w-full rounded-2xl py-3.5 text-[11px] font-black uppercase tracking-widest shadow-lg transition-all ${
                                        successEntry
                                            ? 'bg-emerald-500 text-white shadow-emerald-500/20'
                                            : 'bg-gray-900 text-white hover:bg-black shadow-gray-900/20 disabled:bg-gray-300 disabled:cursor-not-allowed'
                                    }`}
                                >
                                    {isSubmitting ? (
                                        <span className="flex items-center justify-center gap-2">
                                            <Loader2 className="h-4 w-4 animate-spin" /> Logging...
                                        </span>
                                    ) : successEntry ? (
                                        <span className="flex items-center justify-center gap-2">
                                            <Check className="h-4 w-4" /> Logged!
                                        </span>
                                    ) : (
                                        `Log ${quantity} Unit${quantity !== 1 ? 's' : ''} Received`
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
