'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Loader2, Package, Search, X } from '@/components/Icons';
import { getCurrentPSTDateKey, toPSTDateKey, formatTimePST } from '@/lib/timezone';
import { getReceivingLogs, invalidateReceivingCache } from '@/lib/receivingCache';
import { SearchBar } from '@/components/ui/SearchBar';

type ReceivingMode = 'bulk' | 'unboxing' | 'pickup';

interface LogRow {
    id?: string | number;
    timestamp?: string;
    tracking?: string;
    carrier?: string;
    qa_status?: string | null;
    is_return?: boolean;
    zoho_purchase_receive_id?: string | null;
    condition_grade?: string | null;
    disposition_code?: string | null;
    return_platform?: string | null;
    return_reason?: string | null;
    needs_test?: boolean;
    assigned_tech_id?: number | null;
    target_channel?: string | null;
    received_at?: string | null;
    received_by?: number | null;
    unboxed_at?: string | null;
    unboxed_by?: number | null;
    zoho_warehouse_id?: string | null;
    status?: string;
    count?: number;
}

// ─── Mode 1: Bulk Scan ────────────────────────────────────────────────────────

const CARRIERS = [
    { value: '', label: 'Auto' },
    { value: 'UPS', label: 'UPS' },
    { value: 'FEDEX', label: 'FedEx' },
    { value: 'USPS', label: 'USPS' },
    { value: 'AMAZON', label: 'AMZ' },
    { value: 'DHL', label: 'DHL' },
    { value: 'UNIUNI', label: 'UniUni' },
    { value: 'GOFO', label: 'GoFo' },
    { value: 'ALIEXPRESS', label: 'AliEx' },
];

function BulkScanPanel({ onEntryAdded }: { history: LogRow[]; onEntryAdded: () => void }) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [value, setValue] = useState('');
    const [carrier, setCarrier] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [flash, setFlash] = useState<'ok' | 'err' | null>(null);

    useEffect(() => {
        inputRef.current?.focus();
        const refocus = () => requestAnimationFrame(() => inputRef.current?.focus());
        window.addEventListener('receiving-focus-scan', refocus);
        return () => window.removeEventListener('receiving-focus-scan', refocus);
    }, []);

    const submit = useCallback(async () => {
        const tracking = value.trim();
        if (!tracking || submitting) return;
        setSubmitting(true);
        setValue('');
        try {
            const res = await fetch('/api/receiving-entry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trackingNumber: tracking,
                    carrier: carrier || undefined,
                    qaStatus: 'PENDING',
                    dispositionCode: 'HOLD',
                    conditionGrade: 'BRAND_NEW',
                    isReturn: false,
                }),
            });
            if (!res.ok) throw new Error();
            const data = await res.json();
            setFlash('ok');
            invalidateReceivingCache();
            if (data.record) {
                window.dispatchEvent(new CustomEvent('receiving-entry-added', { detail: data.record }));
            }
            window.dispatchEvent(new CustomEvent('usav-refresh-data'));
            onEntryAdded();
            if (data.record?.id) enrichZoho(tracking, Number(data.record.id));
        } catch {
            setFlash('err');
        } finally {
            setSubmitting(false);
            setTimeout(() => setFlash(null), 800);
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [value, carrier, submitting, onEntryAdded]);

    const carrierScrollRef = useRef<HTMLDivElement>(null);

    const handleCarrierWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (carrierScrollRef.current) {
            carrierScrollRef.current.scrollLeft += e.deltaY + e.deltaX;
        }
    }, []);

    return (
        <div className="flex flex-col gap-3 p-3">
            {/* Carrier slider — full-width horizontal scroll, wheel-enabled */}
            <div
                ref={carrierScrollRef}
                onWheel={handleCarrierWheel}
                className="overflow-x-auto w-full"
                style={{ scrollbarWidth: 'thin', scrollbarColor: '#9ca3af #ffffff' }}
            >
                <div className="flex gap-1.5 w-max pb-1">
                    {CARRIERS.map((c) => (
                        <button
                            key={c.value}
                            type="button"
                            onClick={() => setCarrier(c.value)}
                            className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all ${
                                carrier === c.value
                                    ? 'bg-gray-900 text-white'
                                    : 'border border-gray-200 bg-white text-gray-500 hover:text-gray-800 hover:border-gray-300'
                            }`}
                        >
                            {c.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Scan input */}
            <div className={`transition-all duration-150 rounded-2xl ${
                flash === 'ok' ? 'ring-2 ring-emerald-400' :
                flash === 'err' ? 'ring-2 ring-red-400' : ''
            }`}>
                <SearchBar
                    inputRef={inputRef}
                    value={value}
                    onChange={setValue}
                    onSearch={submit}
                    placeholder="Scan or enter tracking…"
                    isSearching={submitting}
                    variant="blue"
                />
            </div>

            <p className="text-center text-[9px] font-medium text-gray-400">
                Enter to log · classify later in Unboxing
            </p>
        </div>
    );
}

// ─── Mode 2: Unboxing Queue ───────────────────────────────────────────────────

function UnboxingQueuePanel({ history }: { history: LogRow[] }) {
    const pending = useMemo(
        () => history.filter((l) => !l.qa_status || l.qa_status === 'PENDING'),
        [history],
    );

    const handleSelect = (entry: LogRow) => {
        // Fire event → ReceivingDashboard opens ReceivingDetailsStack for this entry
        window.dispatchEvent(
            new CustomEvent('receiving-select-log', {
                detail: {
                    id: String(entry.id || ''),
                    timestamp: entry.timestamp || '',
                    tracking: entry.tracking || '',
                    status: entry.carrier || entry.status || '',
                    qa_status: entry.qa_status || 'PENDING',
                    condition_grade: entry.condition_grade || null,
                    disposition_code: entry.disposition_code || null,
                    is_return: !!entry.is_return,
                    return_platform: entry.return_platform || null,
                    return_reason: entry.return_reason || null,
                    needs_test: !!entry.needs_test,
                    assigned_tech_id: entry.assigned_tech_id || null,
                    target_channel: entry.target_channel || null,
                    received_at: entry.received_at || null,
                    received_by: entry.received_by || null,
                    unboxed_at: entry.unboxed_at || null,
                    unboxed_by: entry.unboxed_by || null,
                    zoho_purchase_receive_id: entry.zoho_purchase_receive_id || null,
                    zoho_warehouse_id: entry.zoho_warehouse_id || null,
                },
            }),
        );
    };

    return (
        <div className="flex h-full flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-3">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-gray-400">Pending Unboxing</p>
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${pending.length > 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'}`}>
                    {pending.length}
                </span>
            </div>

            {pending.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                    <Check className="h-8 w-8 text-emerald-300" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-300">All Clear</p>
                    <p className="text-[9px] font-medium text-gray-300">No packages awaiting unboxing</p>
                </div>
            ) : (
                <ul className="flex-1 overflow-y-auto divide-y divide-gray-50">
                    {pending.map((entry) => (
                        <li key={String(entry.id || '')}>
                            <button
                                type="button"
                                onClick={() => handleSelect(entry)}
                                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-amber-50"
                            >
                                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-amber-100">
                                    <Package className="h-3.5 w-3.5 text-amber-600" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-mono text-[10px] font-bold text-gray-900">
                                        {entry.tracking ? `…${entry.tracking.slice(-8)}` : `#${entry.id}`}
                                    </p>
                                    <p className="text-[9px] font-bold text-gray-400">
                                        {entry.carrier || '—'} · {formatTimePST(entry.timestamp || '')}
                                    </p>
                                </div>
                                {entry.zoho_purchase_receive_id && (
                                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-400" />
                                )}
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <div className="border-t border-gray-100 px-3 py-2">
                <p className="text-[9px] font-medium text-gray-400">
                    Click an entry to open details + photos on the right
                </p>
            </div>
        </div>
    );
}

// ─── Mode 3: Local Pickup ─────────────────────────────────────────────────────

interface SkuItem { id: number; sku: string; product_title: string; stock: string }

function LocalPickupPanel({ staffId }: { staffId?: string }) {
    const searchRef = useRef<HTMLInputElement>(null);
    const [allItems, setAllItems] = useState<SkuItem[]>([]);
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<SkuItem | null>(null);
    const [qty, setQty] = useState(1);
    const [condition, setCondition] = useState('BRAND_NEW');
    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);

    // Load all sku_stock rows on mount
    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                const res = await fetch('/api/sku-stock?limit=500', { cache: 'no-store' });
                if (!res.ok) throw new Error();
                const data = await res.json();
                setAllItems(Array.isArray(data?.rows) ? data.rows : []);
            } catch {
                setAllItems([]);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    // Filter client-side by query
    const filtered = query.trim()
        ? allItems.filter((item) => {
              const q = query.toLowerCase();
              return (
                  (item.product_title || '').toLowerCase().includes(q) ||
                  (item.sku || '').toLowerCase().includes(q)
              );
          })
        : allItems;

    const submit = async () => {
        if (!selected || submitting) return;
        setSubmitting(true);
        try {
            const res = await fetch('/api/receiving-entry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trackingNumber: `LOCAL-${selected.sku || selected.id}-${Date.now()}`,
                    carrier: 'LOCAL',
                    conditionGrade: condition,
                    qaStatus: 'PASSED',
                    dispositionCode: 'ACCEPT',
                    isReturn: false,
                    targetChannel: 'ORDERS',
                }),
            });
            if (!res.ok) throw new Error();
            const data = await res.json();
            invalidateReceivingCache();
            if (data.record) window.dispatchEvent(new CustomEvent('receiving-entry-added', { detail: data.record }));
            window.dispatchEvent(new CustomEvent('usav-refresh-data'));
            setDone(true);
            setTimeout(() => { setSelected(null); setDone(false); }, 1800);
        } catch { alert('Failed to log pickup'); } finally { setSubmitting(false); }
    };

    // ── Selected item: confirm form ────────────────────────────────────────
    if (selected) {
        return (
            <div className="flex h-full flex-col overflow-hidden">
                <div className="flex items-start gap-2 border-b border-gray-100 p-3">
                    <button
                        type="button"
                        onClick={() => { setSelected(null); setDone(false); }}
                        className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50"
                    >
                        <X className="h-3 w-3 text-gray-500" />
                    </button>
                    <div className="min-w-0">
                        <p className="text-xs font-black leading-tight text-gray-900 line-clamp-2">{selected.product_title || '—'}</p>
                        <p className="mt-0.5 font-mono text-[9px] font-bold text-blue-600">
                            {selected.sku || '—'} · stock: {selected.stock || '0'}
                        </p>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                    {/* Quantity */}
                    <div>
                        <p className="mb-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-gray-400">Qty Received</p>
                        <div className="flex items-center gap-2">
                            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-base font-bold hover:bg-gray-50">−</button>
                            <span className="w-10 text-center text-xl font-black tabular-nums">{qty}</span>
                            <button type="button" onClick={() => setQty((q) => q + 1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-base font-bold hover:bg-gray-50">+</button>
                        </div>
                    </div>

                    {/* Condition */}
                    <div>
                        <p className="mb-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-gray-400">Condition</p>
                        <select
                            value={condition}
                            onChange={(e) => setCondition(e.target.value)}
                            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-gray-900 outline-none"
                        >
                            <option value="BRAND_NEW">Brand New</option>
                            <option value="USED_A">Used A</option>
                            <option value="USED_B">Used B</option>
                            <option value="USED_C">Used C</option>
                            <option value="PARTS">Parts</option>
                        </select>
                    </div>
                </div>

                <div className="border-t border-gray-100 p-3">
                    <button
                        type="button"
                        onClick={submit}
                        disabled={submitting || done}
                        className={`w-full rounded-xl py-2.5 text-[10px] font-black uppercase tracking-widest transition-all ${
                            done ? 'bg-emerald-500 text-white' : 'bg-gray-900 text-white hover:bg-black disabled:opacity-50'
                        }`}
                    >
                        {submitting ? 'Logging…' : done ? '✓ Logged' : `Log ${qty} Unit${qty !== 1 ? 's' : ''}`}
                    </button>
                </div>
            </div>
        );
    }

    // ── Product list ───────────────────────────────────────────────────────
    return (
        <div className="flex h-full flex-col overflow-hidden">
            {/* Filter input */}
            <div className="border-b border-gray-100 p-3">
                <div className="relative rounded-xl ring-1 ring-gray-200 focus-within:ring-2 focus-within:ring-blue-500">
                    <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2">
                        <Search className="h-3.5 w-3.5 text-gray-400" />
                    </div>
                    <input
                        ref={searchRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Filter products…"
                        className="w-full rounded-xl bg-white py-2.5 pl-8 pr-3 text-xs font-medium text-gray-900 outline-none placeholder:text-gray-400"
                        autoComplete="off"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
                    </div>
                ) : filtered.length === 0 ? (
                    <p className="py-8 text-center text-[10px] font-medium text-gray-300">No products found</p>
                ) : (
                    <ul className="divide-y divide-gray-50">
                        {filtered.map((item) => (
                            <li key={item.id}>
                                <button
                                    type="button"
                                    onClick={() => { setSelected(item); setQty(1); setDone(false); }}
                                    className="w-full px-3 py-2.5 text-left transition-colors hover:bg-emerald-50 active:bg-emerald-100"
                                >
                                    <p className="text-[11px] font-bold leading-snug text-gray-900 line-clamp-2">
                                        {item.product_title || '—'}
                                    </p>
                                    <p className="mt-0.5 font-mono text-[9px] font-bold text-gray-400">
                                        {item.sku || '—'} · {item.stock || '0'} in stock
                                    </p>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

interface ReceivingSidebarProps {
    embedded?: boolean;
    hideSectionHeader?: boolean;
    mode?: ReceivingMode;
    staffId?: string;
}

export default function ReceivingSidebar({
    embedded = false,
    hideSectionHeader = false,
    mode = 'bulk',
    staffId,
}: ReceivingSidebarProps) {
    const [history, setHistory] = useState<LogRow[]>([]);

    const fetchHistory = async () => {
        try {
            const data = await getReceivingLogs(500);
            setHistory(data);
        } catch { /* no-op */ }
    };

    useEffect(() => {
        fetchHistory();

        const onRefresh = () => { invalidateReceivingCache(); fetchHistory(); };
        const onEntry = (e: Event) => {
            const { detail } = e as CustomEvent;
            if (!detail) return;
            setHistory((prev) => [{
                id: detail.id,
                timestamp: detail.timestamp,
                tracking: detail.receiving_tracking_number || detail.tracking,
                carrier: detail.carrier,
                qa_status: detail.qa_status || 'PENDING',
            }, ...prev]);
        };

        window.addEventListener('usav-refresh-data', onRefresh);
        window.addEventListener('receiving-entry-added', onEntry);
        return () => {
            window.removeEventListener('usav-refresh-data', onRefresh);
            window.removeEventListener('receiving-entry-added', onEntry);
        };
    }, []);

    return (
        <div className={`h-full overflow-hidden flex flex-col ${embedded ? '' : 'w-[320px] flex-shrink-0 border-r border-gray-200'}`}>
            {!hideSectionHeader && (
                <div className="border-b border-gray-200 px-4 py-3">
                    <h2 className="text-sm font-black uppercase tracking-tight text-gray-900">Receiving</h2>
                </div>
            )}
            <div className="flex-1 overflow-hidden">
                {mode === 'bulk' && <BulkScanPanel history={history} onEntryAdded={fetchHistory} />}
                {mode === 'unboxing' && <UnboxingQueuePanel history={history} />}
                {mode === 'pickup' && <LocalPickupPanel staffId={staffId} />}
            </div>
        </div>
    );
}

// ─── Zoho background enrichment ───────────────────────────────────────────────

async function enrichZoho(tracking: string, receivingId: number) {
    try {
        const res = await fetch(`/api/zoho/purchase-receives?tracking=${encodeURIComponent(tracking)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!data.found || !data.purchasereceives?.[0]) return;
        const pr = data.purchasereceives[0];
        await fetch('/api/receiving-logs', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: receivingId, zoho_purchase_receive_id: pr.purchase_receive_id, zoho_warehouse_id: pr.warehouse_id || null }),
        });
    } catch { /* non-fatal */ }
}
