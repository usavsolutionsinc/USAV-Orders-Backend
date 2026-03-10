'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { TechTable } from './TechTable';
import PendingOrdersTable from './PendingOrdersTable';
import UpdateManualsView from './UpdateManualsView';
import { StationDetailsHandler } from './station/StationDetailsHandler';
import ProductManualViewer from './station/ProductManualViewer';
import { ReceivingInboundFeed } from './station/ReceivingInboundFeed';
import { ReceivingDetailsStack, type ReceivingDetailsLog } from './station/ReceivingDetailsStack';
import { RepairDetailsPanel } from './repair/RepairDetailsPanel';
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
    const searchParams = useSearchParams();
    const queryClient = useQueryClient();

    const rawView = searchParams.get('view');
    const rightViewMode = rawView === 'pending'
        ? 'pending'
        : rawView === 'manual'
            ? 'manual'
            : rawView === 'update-manuals'
                ? 'update-manuals'
                : rawView === 'receiving'
                    ? 'receiving'
                    : 'history';

    const [lastManuals, setLastManuals] = useState<ResolvedProductManual[]>([]);
    const [selectedLog, setSelectedLog] = useState<ReceivingDetailsLog | null>(null);
    const [repairPanel, setRepairPanel] = useState<{
        record: RSRecord;
        assignmentId: number | null;
        assignedTechId: number | null;
    } | null>(null);
    const [loadingRepair, setLoadingRepair] = useState(false);

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

    return (
        <div className="flex h-full w-full relative">
            <div className="flex-1 overflow-hidden">
                {rightViewMode === 'manual' ? (
                    <div className="h-full w-full bg-gray-50 p-4">
                        <ProductManualViewer manuals={lastManuals} className="h-full" />
                    </div>
                ) : rightViewMode === 'pending' ? (
                    <PendingOrdersTable />
                ) : rightViewMode === 'update-manuals' ? (
                    <UpdateManualsView techId={techId} days={30} />
                ) : rightViewMode === 'receiving' ? (
                    <ReceivingInboundFeed onSelectLog={setSelectedLog} />
                ) : (
                    <TechTable testedBy={parseInt(techId)} />
                )}
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
