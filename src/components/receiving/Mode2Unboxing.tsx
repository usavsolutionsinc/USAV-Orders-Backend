'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Check, ChevronRight, Loader2, Package, RefreshCw, X } from '@/components/Icons';
import { formatTimePST, getCurrentPSTDateKey, toPSTDateKey } from '@/utils/date';
import { getActiveStaff } from '@/lib/staffCache';
import { FormField } from '@/design-system/components';
import { ExpandableSection } from '@/design-system/primitives';
import { sectionLabel, fieldLabel, cardTitle, chipText, monoValue, microBadge } from '@/design-system/tokens/typography/presets';
import { framerTransition, framerPresence } from '@/design-system/foundations/motion-framer';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReceivingLog {
    id: string;
    timestamp: string;
    tracking: string;
    status: string;
    qa_status?: string | null;
    disposition_code?: string | null;
    condition_grade?: string | null;
    is_return?: boolean;
    return_platform?: string | null;
    return_reason?: string | null;
    needs_test?: boolean;
    assigned_tech_id?: number | null;
    target_channel?: string | null;
    zoho_purchase_receive_id?: string | null;
    zoho_warehouse_id?: string | null;
}

interface ReceivingPhoto {
    id: number;
    receivingId: number;
    photoUrl: string;
    caption: string | null;
    uploadedBy: number | null;
    createdAt: string;
}

interface StaffOption {
    id: number;
    name: string;
    role: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONDITION_OPTIONS = [
    { value: 'BRAND_NEW', label: 'Brand New' },
    { value: 'USED_A', label: 'Used — A' },
    { value: 'USED_B', label: 'Used — B' },
    { value: 'USED_C', label: 'Used — C' },
    { value: 'PARTS', label: 'Parts Only' },
];

const QA_STATUS_OPTIONS = [
    { value: 'PASSED', label: 'Passed', color: 'emerald' },
    { value: 'FAILED_DAMAGED', label: 'Failed — Damaged', color: 'red' },
    { value: 'FAILED_INCOMPLETE', label: 'Failed — Incomplete', color: 'red' },
    { value: 'FAILED_FUNCTIONAL', label: 'Failed — Functional', color: 'red' },
    { value: 'HOLD', label: 'Hold', color: 'amber' },
];

const DISPOSITION_OPTIONS = [
    { value: 'ACCEPT', label: 'Accept' },
    { value: 'HOLD', label: 'Hold' },
    { value: 'RTV', label: 'Return to Vendor' },
    { value: 'SCRAP', label: 'Scrap' },
    { value: 'REWORK', label: 'Rework' },
];

const RETURN_PLATFORM_OPTIONS = [
    { value: 'AMZ', label: 'Amazon' },
    { value: 'EBAY_DRAGONH', label: 'eBay Dragonh' },
    { value: 'EBAY_USAV', label: 'eBay USAV' },
    { value: 'EBAY_MK', label: 'eBay MK' },
    { value: 'FBA', label: 'FBA' },
    { value: 'WALMART', label: 'Walmart' },
    { value: 'ECWID', label: 'Ecwid' },
];

// ─── Hooks ────────────────────────────────────────────────────────────────────

function usePendingEntries() {
    return useQuery<ReceivingLog[]>({
        queryKey: ['receiving-logs', 'pending-unboxing'],
        queryFn: async () => {
            const res = await fetch('/api/receiving-logs?limit=200&offset=0');
            if (!res.ok) throw new Error('Failed to fetch logs');
            const data: ReceivingLog[] = await res.json();
            return data.filter((l) => !l.qa_status || l.qa_status === 'PENDING');
        },
        staleTime: 45_000,
        refetchInterval: 60_000,
    });
}

function usePhotos(receivingId: string | null, enabled: boolean) {
    return useQuery<ReceivingPhoto[]>({
        queryKey: ['receiving-photos', receivingId],
        queryFn: async () => {
            if (!receivingId) return [];
            const res = await fetch(`/api/receiving-photos?receivingId=${receivingId}`);
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data.photos) ? data.photos : [];
        },
        enabled: enabled && !!receivingId,
        refetchInterval: 15_000,
        staleTime: 10_000,
    });
}

function useStaff() {
    const [staff, setStaff] = useState<StaffOption[]>([]);
    useEffect(() => {
        let active = true;
        getActiveStaff()
            .then((data) => {
                if (active) setStaff(data);
            })
            .catch(() => {});
        return () => { active = false; };
    }, []);
    return staff;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PhotoGrid({ receivingId }: { receivingId: string }) {
    const { data: photos = [], isFetching } = usePhotos(receivingId, true);
    const queryClient = useQueryClient();

    const handleDelete = async (photoId: number) => {
        await fetch(`/api/receiving-photos?id=${photoId}`, { method: 'DELETE' });
        queryClient.invalidateQueries({ queryKey: ['receiving-photos', receivingId] });
    };

    return (
        <div>
            <div className="mb-3 flex items-center gap-2">
                <Camera className="h-4 w-4 text-gray-500" />
                <p className={sectionLabel}>
                    Photos ({photos.length})
                </p>
                {isFetching && <Loader2 className="h-3 w-3 animate-spin text-gray-400" />}
            </div>

            {photos.length === 0 ? (
                <div className="flex h-28 items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50">
                    <div className="text-center">
                        <Camera className="mx-auto mb-1 h-6 w-6 text-gray-400" />
                        <p className={`${sectionLabel} text-gray-400`}>
                            Waiting for mobile photos
                        </p>
                        <p className={`mt-0.5 ${microBadge} text-gray-500`}>
                            Entry ID: <span className="font-mono font-bold">{receivingId}</span>
                        </p>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-3 gap-2">
                    {photos.map((photo) => (
                        <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-xl bg-gray-100">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={photo.photoUrl}
                                alt={photo.caption || `Photo ${photo.id}`}
                                className="h-full w-full object-cover"
                            />
                            <button
                                type="button"
                                onClick={() => handleDelete(photo.id)}
                                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2">
                <p className="text-[10px] font-bold text-blue-700">
                    Open the mobile app → Receiving Station → select entry <span className="font-mono font-black">#{receivingId}</span> to take photos. Page auto-refreshes every 3s.
                </p>
            </div>
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Mode2UnboxingProps {
    staffId?: string;
}

export default function Mode2Unboxing({ staffId }: Mode2UnboxingProps) {
    const queryClient = useQueryClient();
    const [selectedEntry, setSelectedEntry] = useState<ReceivingLog | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    // Classification form state
    const [isReturn, setIsReturn] = useState(false);
    const [returnPlatform, setReturnPlatform] = useState('');
    const [returnReason, setReturnReason] = useState('');
    const [conditionGrade, setConditionGrade] = useState('BRAND_NEW');
    const [qaStatus, setQaStatus] = useState('PASSED');
    const [dispositionCode, setDispositionCode] = useState('ACCEPT');
    const [needsTest, setNeedsTest] = useState(true);
    const [assignedTechId, setAssignedTechId] = useState('');
    const [targetChannel, setTargetChannel] = useState('');
    const [zohoConfirm, setZohoConfirm] = useState(false);

    const { data: pendingEntries = [], isLoading, refetch } = usePendingEntries();
    const staff = useStaff();
    const technicians = staff.filter((s) => s.role === 'technician');

    const selectEntry = (entry: ReceivingLog) => {
        setSelectedEntry(entry);
        setIsReturn(entry.is_return || false);
        setReturnPlatform(entry.return_platform || '');
        setReturnReason(entry.return_reason || '');
        setConditionGrade(entry.condition_grade || 'BRAND_NEW');
        setQaStatus('PASSED');
        setDispositionCode('ACCEPT');
        setNeedsTest(entry.needs_test !== false);
        setAssignedTechId(entry.assigned_tech_id ? String(entry.assigned_tech_id) : '');
        setTargetChannel(entry.target_channel || '');
        setZohoConfirm(false);
        setSaveSuccess(false);
    };

    const handleConfirm = async () => {
        if (!selectedEntry || isSaving) return;
        setIsSaving(true);

        try {
            const techId = Number(assignedTechId);
            const unboxedBy = staffId ? Number(staffId) : null;
            const now = new Date().toISOString();

            const patchBody: Record<string, unknown> = {
                id: Number(selectedEntry.id),
                qa_status: qaStatus,
                disposition_code: dispositionCode,
                condition_grade: conditionGrade,
                is_return: isReturn,
                return_platform: isReturn ? (returnPlatform || null) : null,
                return_reason: isReturn ? (returnReason.trim() || null) : null,
                needs_test: needsTest,
                assigned_tech_id: needsTest && Number.isFinite(techId) && techId > 0 ? techId : null,
                target_channel: targetChannel || null,
                unboxed_by: unboxedBy,
                unboxed_at: now,
            };

            const patchRes = await fetch('/api/receiving-logs', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patchBody),
            });

            if (!patchRes.ok) {
                const err = await patchRes.json().catch(() => ({}));
                throw new Error(err?.error || `PATCH failed: ${patchRes.status}`);
            }

            // Optional Zoho confirmation
            if (zohoConfirm && selectedEntry.zoho_purchase_receive_id) {
                // Best-effort — don't block on Zoho errors
                fetch('/api/zoho/purchase-receives', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ purchase_receive_id: selectedEntry.zoho_purchase_receive_id }),
                }).catch(() => {});
            }

            setSaveSuccess(true);
            queryClient.invalidateQueries({ queryKey: ['receiving-logs'] });
            window.dispatchEvent(new CustomEvent('usav-refresh-data'));

            setTimeout(() => {
                setSelectedEntry(null);
                setSaveSuccess(false);
                refetch();
            }, 1200);
        } catch (err: any) {
            alert(err?.message || 'Failed to save classification');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex h-full overflow-hidden">
            {/* Left: PENDING queue */}
            <div className={`flex flex-col border-r border-gray-200 bg-white transition-[width] duration-300 ${selectedEntry ? 'w-72 flex-shrink-0' : 'flex-1'}`}>
                <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3">
                    <div>
                        <p className={sectionLabel}>Mode 2</p>
                        <h2 className={`${cardTitle} uppercase tracking-tight leading-none`}>Unboxing Queue</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`rounded-full bg-amber-100 px-2.5 py-0.5 ${chipText} text-amber-700`}>
                            {pendingEntries.length}
                        </span>
                        <button
                            type="button"
                            onClick={() => refetch()}
                            className="flex h-8 w-8 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 transition-colors"
                        >
                            <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>

                {isLoading ? (
                    <div className="flex flex-1 items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
                    </div>
                ) : pendingEntries.length === 0 ? (
                    <div className="flex flex-1 flex-col items-center justify-center text-center px-6">
                        <Check className="mb-3 h-10 w-10 text-emerald-400" />
                        <p className={sectionLabel}>All Clear</p>
                        <p className="mt-1 text-[10px] font-semibold text-gray-500">No pending packages to unbox</p>
                    </div>
                ) : (
                    <ul className="flex-1 overflow-y-auto divide-y divide-gray-50">
                        {pendingEntries.map((entry) => (
                            <li key={entry.id}>
                                <button
                                    type="button"
                                    onClick={() => selectEntry(entry)}
                                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                                        selectedEntry?.id === entry.id ? 'bg-blue-50 border-r-2 border-blue-500' : ''
                                    }`}
                                >
                                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100">
                                        <Package className="h-4 w-4 text-amber-600" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className={`truncate ${chipText} text-gray-900`}>
                                            {entry.tracking ? `...${entry.tracking.slice(-8)}` : `#${entry.id}`}
                                        </p>
                                        <p className={`${microBadge} tracking-wider text-gray-500`}>
                                            {entry.status || 'Unknown'} · {formatTimePST(entry.timestamp)}
                                        </p>
                                    </div>
                                    {entry.zoho_purchase_receive_id && (
                                        <span className="flex-shrink-0 h-2 w-2 rounded-full bg-emerald-400" title="Zoho PO linked" />
                                    )}
                                    <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Right: Classification panel */}
            <AnimatePresence>
                {selectedEntry && (
                    <motion.div
                        initial={{ opacity: 0, x: 24 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 24 }}
                        transition={framerTransition.stationCardMount}
                        className="flex flex-1 flex-col overflow-hidden bg-white"
                    >
                        {/* Panel header */}
                        <div className="flex items-center gap-3 border-b border-gray-200 bg-gray-50 px-5 py-3">
                            <button
                                type="button"
                                onClick={() => setSelectedEntry(null)}
                                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
                            >
                                <X className="h-4 w-4 text-gray-500" />
                            </button>
                            <div className="min-w-0 flex-1">
                                <p className={`${monoValue} truncate`}>
                                    {selectedEntry.tracking || `Entry #${selectedEntry.id}`}
                                </p>
                                <p className={`${microBadge} tracking-wider text-gray-500`}>
                                    {selectedEntry.status} · {formatTimePST(selectedEntry.timestamp)}
                                    {selectedEntry.zoho_purchase_receive_id && (
                                        <span className="ml-2 text-emerald-600">· Zoho PO</span>
                                    )}
                                </p>
                            </div>
                        </div>

                        {/* Scrollable body */}
                        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                            {/* Photos */}
                            <PhotoGrid receivingId={selectedEntry.id} />

                            <div className="border-t border-gray-100 pt-4 space-y-4">
                                {/* Package type */}
                                <FormField label="Package Type">
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setIsReturn(false)}
                                            className={`rounded-xl border px-3 py-2.5 text-[10px] font-black uppercase tracking-widest transition-all ${
                                                !isReturn
                                                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                                                    : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'
                                            }`}
                                        >
                                            Purchase Order
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setIsReturn(true)}
                                            className={`rounded-xl border px-3 py-2.5 text-[10px] font-black uppercase tracking-widest transition-all ${
                                                isReturn
                                                    ? 'border-amber-300 bg-amber-50 text-amber-700'
                                                    : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'
                                            }`}
                                        >
                                            Return
                                        </button>
                                    </div>
                                </FormField>

                                {/* Return fields */}
                                <ExpandableSection isOpen={isReturn}>
                                    <div className="space-y-2 pt-1">
                                        <FormField label="Return Platform">
                                            <select
                                                value={returnPlatform}
                                                onChange={(e) => setReturnPlatform(e.target.value)}
                                                className="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-amber-800 outline-none focus:border-amber-400"
                                            >
                                                <option value="">Select platform</option>
                                                {RETURN_PLATFORM_OPTIONS.map((opt) => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                        </FormField>
                                        <FormField label="Return Reason" optionalHint="optional">
                                            <textarea
                                                value={returnReason}
                                                onChange={(e) => setReturnReason(e.target.value)}
                                                placeholder="Return reason"
                                                rows={2}
                                                className="w-full resize-none rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-medium text-gray-800 outline-none focus:border-amber-400 placeholder:text-amber-400"
                                            />
                                        </FormField>
                                    </div>
                                </ExpandableSection>

                                {/* Condition */}
                                <FormField label="Condition">
                                    <div className="flex flex-wrap gap-1.5">
                                        {CONDITION_OPTIONS.map((opt) => (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => setConditionGrade(opt.value)}
                                                className={`rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all ${
                                                    conditionGrade === opt.value
                                                        ? 'bg-gray-900 text-white'
                                                        : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                                                }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </FormField>

                                {/* QA Status */}
                                <FormField label="QA Status">
                                    <div className="flex flex-wrap gap-1.5">
                                        {QA_STATUS_OPTIONS.map((opt) => (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => setQaStatus(opt.value)}
                                                className={`rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all ${
                                                    qaStatus === opt.value
                                                        ? opt.color === 'emerald'
                                                            ? 'bg-emerald-600 text-white'
                                                            : opt.color === 'red'
                                                            ? 'bg-red-600 text-white'
                                                            : 'bg-amber-500 text-white'
                                                        : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                                                }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </FormField>

                                {/* Disposition */}
                                <FormField label="Disposition">
                                    <select
                                        value={dispositionCode}
                                        onChange={(e) => setDispositionCode(e.target.value)}
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-gray-900 outline-none focus:border-blue-500"
                                    >
                                        {DISPOSITION_OPTIONS.map((opt) => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </FormField>

                                {/* Needs Test + Tech */}
                                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
                                    <label className={`flex cursor-pointer items-center gap-2 ${fieldLabel}`}>
                                        <input
                                            type="checkbox"
                                            checked={needsTest}
                                            onChange={(e) => setNeedsTest(e.target.checked)}
                                            className="h-4 w-4 rounded border-gray-300"
                                        />
                                        Needs Testing
                                    </label>
                                    <ExpandableSection isOpen={needsTest}>
                                        <FormField label="Assign Technician">
                                            <select
                                                value={assignedTechId}
                                                onChange={(e) => setAssignedTechId(e.target.value)}
                                                className={`w-full rounded-xl border border-gray-200 bg-white px-3 py-2 ${fieldLabel} text-gray-900 outline-none focus:border-purple-500`}
                                            >
                                                <option value="">Select technician</option>
                                                {technicians.map((t) => (
                                                    <option key={t.id} value={String(t.id)}>{t.name}</option>
                                                ))}
                                            </select>
                                        </FormField>
                                    </ExpandableSection>
                                    <FormField label="Target Channel" optionalHint="optional">
                                        <select
                                            value={targetChannel}
                                            onChange={(e) => setTargetChannel(e.target.value)}
                                            className={`w-full rounded-xl border border-gray-200 bg-white px-3 py-2 ${fieldLabel} text-gray-900 outline-none`}
                                        >
                                            <option value="">No Target Channel</option>
                                            <option value="ORDERS">Orders</option>
                                            <option value="FBA">FBA</option>
                                        </select>
                                    </FormField>
                                </div>

                                {/* Zoho confirmation */}
                                {selectedEntry.zoho_purchase_receive_id && (
                                    <label className={`flex cursor-pointer items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 ${fieldLabel} text-emerald-700`}>
                                        <input
                                            type="checkbox"
                                            checked={zohoConfirm}
                                            onChange={(e) => setZohoConfirm(e.target.checked)}
                                            className="h-4 w-4 rounded"
                                        />
                                        Confirm in Zoho Inventory
                                    </label>
                                )}
                            </div>
                        </div>

                        {/* Confirm button */}
                        <div className="border-t border-gray-200 p-4">
                            <button
                                type="button"
                                onClick={handleConfirm}
                                disabled={isSaving || saveSuccess}
                                className={`w-full rounded-xl py-3.5 ${chipText} uppercase tracking-widest shadow-lg transition-all ${
                                    saveSuccess
                                        ? 'bg-emerald-500 text-white shadow-emerald-500/20'
                                        : 'bg-gray-900 text-white hover:bg-black shadow-gray-900/20 disabled:bg-gray-300 disabled:cursor-not-allowed'
                                }`}
                            >
                                {isSaving ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <Loader2 className="h-4 w-4 animate-spin" /> Saving...
                                    </span>
                                ) : saveSuccess ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <Check className="h-4 w-4" /> Confirmed
                                    </span>
                                ) : (
                                    'Confirm Unboxing'
                                )}
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Empty state when no entry selected */}
            {!selectedEntry && pendingEntries.length > 0 && (
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                    <Package className="mb-3 h-10 w-10 text-gray-300" />
                    <p className={sectionLabel}>Select a package</p>
                    <p className="mt-1 text-[10px] font-semibold text-gray-500">Pick an entry from the queue to begin unboxing</p>
                </div>
            )}
        </div>
    );
}
