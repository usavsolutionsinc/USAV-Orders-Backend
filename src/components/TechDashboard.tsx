'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { TechTable } from './TechTable';
import PendingOrdersTable from './PendingOrdersTable';
import { DashboardShippedTable } from './shipped';
import UpdateManualsView from './UpdateManualsView';
import { StationDetailsHandler } from './station/StationDetailsHandler';
import ProductManualViewer from './station/ProductManualViewer';
import { ReceivingInboundFeed } from './station/ReceivingInboundFeed';
import { ReceivingDetailsStack, type ReceivingDetailsLog } from './station/ReceivingDetailsStack';
import { RepairDetailsPanel } from './repair/RepairDetailsPanel';
import { OverlaySearchBar } from '@/components/ui/OverlaySearchBar';
import { Search } from '@/components/Icons';
import { resolveOrderSearchView } from '@/lib/order-search-resolver';
import type { RSRecord } from '@/lib/neon/repair-service-queries';
import type { ResolvedProductManual } from '@/hooks/useStationTestingController';

interface OpenRepairDetail {
  repairId:       number;
  assignmentId:   number | null;
  assignedTechId: number | null;
}

interface TechDashboardProps {
    techId: string;
}

export default function TechDashboard({ techId }: TechDashboardProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const queryClient = useQueryClient();
    const prefersReducedMotion = useReducedMotion();
    const searchInputRef = useRef<HTMLInputElement | null>(null);

    const rawView = searchParams.get('view');
    const currentSearch = String(searchParams.get('search') || '');
    const searchOpen = searchParams.get('searchOpen') === '1';
    const rightViewMode = rawView === 'pending'
        ? 'pending'
        : rawView === 'shipped'
            ? 'shipped'
            : rawView === 'manual'
                ? 'manual'
                : rawView === 'update-manuals'
                    ? 'update-manuals'
                    : rawView === 'receiving'
                        ? 'receiving'
                        : 'history';

    const [lastManuals, setLastManuals] = useState<ResolvedProductManual[]>([]);
    const [selectedLog, setSelectedLog] = useState<ReceivingDetailsLog | null>(null);
    const [searchInput, setSearchInput] = useState(currentSearch);
    const [repairPanel, setRepairPanel] = useState<{
        record: RSRecord;
        assignmentId: number | null;
        assignedTechId: number | null;
    } | null>(null);
    const [loadingRepair, setLoadingRepair] = useState(false);

    useEffect(() => {
        setSearchInput(currentSearch);
    }, [currentSearch]);

    useEffect(() => {
        const storageKey = `usav:last-manual:tech:${techId}`;
        try {
            const raw = window.localStorage.getItem(storageKey);
            if (!raw) { setLastManuals([]); return; }
            const parsed = JSON.parse(raw);
            setLastManuals(Array.isArray(parsed) ? parsed : [parsed]);
        } catch {
            setLastManuals([]);
        }

        const handleManualUpdate = (event: Event) => {
            const custom = event as CustomEvent<{ techId?: string; manuals?: ResolvedProductManual[] }>;
            if (String(custom?.detail?.techId || '') !== String(techId)) return;
            setLastManuals(Array.isArray(custom?.detail?.manuals) ? custom.detail.manuals : []);
        };

        window.addEventListener('tech-last-manual-updated', handleManualUpdate as EventListener);
        return () => window.removeEventListener('tech-last-manual-updated', handleManualUpdate as EventListener);
    }, [techId]);

    // Listen for repair card clicks dispatched by RepairCard (inside sidebar)
    useEffect(() => {
        const handleOpenRepair = async (e: Event) => {
            const { repairId, assignmentId, assignedTechId } = (e as CustomEvent<OpenRepairDetail>).detail;
            setLoadingRepair(true);
            try {
                const res = await fetch(`/api/repair-service/${repairId}`);
                if (res.ok) {
                    const data = await res.json();
                    const record: RSRecord = data.repair ?? data;
                    setRepairPanel({ record, assignmentId, assignedTechId });
                }
            } catch (err) {
                console.error('Error loading repair details:', err);
            } finally {
                setLoadingRepair(false);
            }
        };
        window.addEventListener('open-repair-details', handleOpenRepair);
        return () => window.removeEventListener('open-repair-details', handleOpenRepair);
    }, []);

    // Listen for receiving-select-log events (fired by ReceivingInboundFeed row clicks)
    useEffect(() => {
        const handleSelectLog = (e: Event) => {
            const custom = e as CustomEvent<ReceivingDetailsLog>;
            if (custom.detail) setSelectedLog(custom.detail);
        };
        window.addEventListener('receiving-select-log', handleSelectLog);
        return () => window.removeEventListener('receiving-select-log', handleSelectLog);
    }, []);

    const showPendingSearch = (rightViewMode === 'pending' || rightViewMode === 'shipped') && (searchOpen || Boolean(currentSearch));

    const updatePendingSearch = (value: string, keepOpen = true, resolvedView?: 'pending' | 'shipped') => {
        const nextParams = new URLSearchParams(searchParams.toString());
        nextParams.set('staffId', techId);
        nextParams.set('view', resolvedView ?? 'pending');
        if (value.trim()) nextParams.set('search', value.trim());
        else nextParams.delete('search');
        if (keepOpen) nextParams.set('searchOpen', '1');
        else nextParams.delete('searchOpen');
        const nextSearch = nextParams.toString();
        router.replace(nextSearch ? `/tech?${nextSearch}` : '/tech');
    };

    const applySearchWithResolvedView = async (value: string, keepOpen: boolean) => {
        const trimmed = value.trim();
        if (!trimmed) {
            clearPendingSearch();
            return;
        }
        try {
            const result = await resolveOrderSearchView(trimmed);
            const view = result.view ?? 'pending';
            const nextParams = new URLSearchParams(searchParams.toString());
            nextParams.set('staffId', techId);
            nextParams.set('view', view);
            nextParams.set('search', trimmed);
            if (keepOpen) nextParams.set('searchOpen', '1');
            else nextParams.delete('searchOpen');
            if (result.firstOrderId) nextParams.set('openOrderId', String(result.firstOrderId));
            else nextParams.delete('openOrderId');
            router.replace(`/tech?${nextParams.toString()}`);
        } catch {
            updatePendingSearch(trimmed, keepOpen, 'pending');
        }
    };

    const clearPendingSearch = () => {
        setSearchInput('');
        const nextParams = new URLSearchParams(searchParams.toString());
        nextParams.set('staffId', techId);
        nextParams.delete('search');
        nextParams.delete('searchOpen');
        nextParams.delete('openOrderId');
        if (rightViewMode === 'pending' || rightViewMode === 'shipped') {
            nextParams.delete('view');
        }
        const nextSearch = nextParams.toString();
        router.replace(nextSearch ? `/tech?${nextSearch}` : '/tech');
    };

    const openPendingSearch = () => {
        const nextParams = new URLSearchParams(searchParams.toString());
        nextParams.set('staffId', techId);
        nextParams.set('view', 'pending');
        nextParams.set('searchOpen', '1');
        const nextSearch = nextParams.toString();
        router.replace(nextSearch ? `/tech?${nextSearch}` : '/tech');
    };

    useEffect(() => {
        if (!showPendingSearch) return;
        const timeoutId = window.setTimeout(() => {
            const normalizedCurrent = currentSearch.trim();
            const normalizedNext = searchInput.trim();
            if (normalizedCurrent === normalizedNext) return;
            applySearchWithResolvedView(searchInput, true);
        }, 180);
        return () => window.clearTimeout(timeoutId);
    }, [searchInput, currentSearch, showPendingSearch]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!showPendingSearch) return;
        const timeoutId = window.setTimeout(() => {
            searchInputRef.current?.focus();
            searchInputRef.current?.select();
        }, 40);
        return () => window.clearTimeout(timeoutId);
    }, [showPendingSearch]);

    const handleLogUpdated = () => {
        setSelectedLog(null);
        queryClient.invalidateQueries({ queryKey: ['receiving-logs'] });
        queryClient.invalidateQueries({ queryKey: ['receiving-inbound-feed'] });
        queryClient.invalidateQueries({ queryKey: ['receiving-pending-unboxing'] });
    };

    const handleLogDeleted = () => {
        setSelectedLog(null);
        queryClient.invalidateQueries({ queryKey: ['receiving-logs'] });
        queryClient.invalidateQueries({ queryKey: ['receiving-inbound-feed'] });
        queryClient.invalidateQueries({ queryKey: ['receiving-pending-unboxing'] });
    };

    const searchOverlayTransition = prefersReducedMotion
        ? { duration: 0.01 }
        : { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const };

    return (
        <div className="flex h-full w-full relative">
            <div className="relative flex-1 overflow-hidden">
                {rightViewMode === 'manual' ? (
                    <div className="h-full w-full bg-gray-50 p-4">
                        <ProductManualViewer manuals={lastManuals} className="h-full" />
                    </div>
                ) : rightViewMode === 'pending' ? (
                    <PendingOrdersTable />
                ) : rightViewMode === 'shipped' ? (
                    <DashboardShippedTable testedBy={parseInt(techId)} />
                ) : rightViewMode === 'update-manuals' ? (
                    <UpdateManualsView techId={techId} days={30} />
                ) : rightViewMode === 'receiving' ? (
                    <ReceivingInboundFeed onSelectLog={setSelectedLog} />
                ) : (
                    <TechTable testedBy={parseInt(techId)} />
                )}

                <AnimatePresence initial={false} mode="wait">
                    {showPendingSearch && (
                        <div key="pending-search-bar" className="absolute bottom-3 left-3 z-30 w-[320px]">
                            <OverlaySearchBar
                                value={searchInput}
                                onChange={setSearchInput}
                                inputRef={searchInputRef}
                                placeholder="Search pending orders"
                                variant="blue"
                                className="w-full"
                                onClear={clearPendingSearch}
                                onClose={clearPendingSearch}
                            />
                        </div>
                    )}
                </AnimatePresence>

                <AnimatePresence initial={false} mode="wait">
                    {!showPendingSearch && rightViewMode === 'history' && (
                        <motion.button
                            key="pending-search-trigger"
                            type="button"
                            initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, x: -8 }}
                            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
                            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: -8 }}
                            whileHover={prefersReducedMotion ? undefined : { scale: 1.04 }}
                            whileTap={prefersReducedMotion ? undefined : { scale: 0.96 }}
                            transition={searchOverlayTransition}
                            onClick={openPendingSearch}
                            className="absolute bottom-3 left-3 z-30 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm shadow-blue-600/25 will-change-transform transition hover:bg-blue-500"
                            aria-label="Open pending order search"
                        >
                            <Search className="h-4 w-4" />
                        </motion.button>
                    )}
                </AnimatePresence>
            </div>

            <StationDetailsHandler viewMode={rightViewMode === 'update-manuals' || rightViewMode === 'receiving' ? 'history' : rightViewMode} />

            {/* ReceivingDetailsStack — shown when a receiving log is selected from the inbound feed */}
            <AnimatePresence>
                {selectedLog && (
                    <ReceivingDetailsStack
                        log={selectedLog}
                        onClose={() => setSelectedLog(null)}
                        onUpdated={handleLogUpdated}
                        onDeleted={handleLogDeleted}
                    />
                )}
            </AnimatePresence>

            {/* RepairDetailsPanel — triggered by repair card clicks anywhere on the page */}
            {loadingRepair && (
                <div className="fixed inset-0 bg-black/20 z-[99] flex items-center justify-center pointer-events-none">
                    <div className="w-8 h-8 border-4 border-orange-400 border-t-transparent rounded-full animate-spin pointer-events-auto" />
                </div>
            )}
            <AnimatePresence>
                {repairPanel && (
                    <RepairDetailsPanel
                        repair={repairPanel.record}
                        assignmentId={repairPanel.assignmentId}
                        assignedTechId={repairPanel.assignedTechId}
                        onClose={() => setRepairPanel(null)}
                        onUpdate={() => setRepairPanel(null)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
