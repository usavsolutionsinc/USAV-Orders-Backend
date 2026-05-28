'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { TechTable } from './TechTable';
import PendingOrdersTable from './PendingOrdersTable';
import { DashboardShippedTable } from './shipped';
import { StationDetailsHandler } from './station/StationDetailsHandler';
import { ReceivingInboundFeed } from './station/ReceivingInboundFeed';
import { ReceivingDetailsStack, type ReceivingDetailsLog } from './station/ReceivingDetailsStack';
import { RepairDetailsPanel } from './repair/RepairDetailsPanel';
import { ActiveOrderWorkspace } from './tech/ActiveOrderWorkspace';
import { TechTestingWorkspace } from './tech/TechTestingWorkspace';
import type { RSRecord } from '@/lib/neon/repair-service-queries';
import type { ActiveStationOrder, ResolvedProductManual } from '@/hooks/useStationTestingController';
import type { Order } from '@/components/station/upnext/upnext-types';
import type { UpNextPreviewPayload } from '@/utils/events';

interface OpenRepairDetail {
  repairId:       number;
  assignmentId:   number | null;
  assignedTechId: number | null;
}

/**
 * Build the synthetic `ActiveStationOrder` shape consumed by the workspace
 * card from an Up Next `Order`. Used for the right-pane preview when a tech
 * clicks a card before scanning (no serials, no test data yet).
 */
function previewOrderToActiveShape(order: Order): ActiveStationOrder {
  const qty = Math.max(1, parseInt(String(order.quantity || '1'), 10) || 1);
  return {
    id: order.id,
    orderId: order.order_id,
    productTitle: order.product_title || '',
    itemNumber: order.item_number,
    sku: order.sku || '',
    condition: order.condition || '',
    notes: '',
    tracking: order.shipping_tracking_number || '',
    serialNumbers: [],
    testDateTime: null,
    testedBy: null,
    quantity: qty,
    shipByDate: order.ship_by_date,
    createdAt: order.created_at,
    orderFound: true,
    sourceType: 'order',
  };
}

interface TechDashboardProps {
    techId: string;
}

export default function TechDashboard({ techId }: TechDashboardProps) {
    const searchParams = useSearchParams();
    const queryClient = useQueryClient();
    const prefersReducedMotion = useReducedMotion();

    const rawView = searchParams.get('view');
    const rightViewMode = rawView === 'pending'
        ? 'pending'
        : rawView === 'receiving'
            ? 'receiving'
            : rawView === 'history'
                ? 'history'
                : rawView === 'testing'
                    ? 'testing'
                    : 'shipped';
    const [selectedLog, setSelectedLog] = useState<ReceivingDetailsLog | null>(null);
    const [repairPanel, setRepairPanel] = useState<{
        record: RSRecord;
        assignmentId: number | null;
        assignedTechId: number | null;
    } | null>(null);
    const [loadingRepair, setLoadingRepair] = useState(false);
    // Active-order workspace state — populated by `tech-active-order-changed`
    // dispatched from `useStationTestingController`. When set, the history
    // branch crossfades into `<ActiveOrderWorkspace/>` instead of `<TechTable/>`.
    const [activeOrderPane, setActiveOrderPane] = useState<{
        activeOrder: ActiveStationOrder;
        manuals: ResolvedProductManual[];
        isManualLoading: boolean;
    } | null>(null);
    // Up Next preview state — populated by `tech-upnext-preview` (dispatched
    // when a tech clicks an Up Next card). Lower priority than the active
    // order: if both are set, active wins.
    const [previewOrder, setPreviewOrder] = useState<Order | null>(null);
    // Currently-selected receiving line id for the testing pane. Lives at
    // dashboard level so the sidebar's recent rail (rendered separately in
    // TechSidebarPanel) can highlight the same row the workspace shows.
    const [testingLineId, setTestingLineId] = useState<number | null>(null);

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

    // Listen for active-order changes from useStationTestingController (sidebar).
    // Payload is null when the active order clears — that returns the pane to history.
    // When a scan resolves into an active order, also clear any standing preview.
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<{
                activeOrder: ActiveStationOrder;
                manuals: ResolvedProductManual[];
                isManualLoading: boolean;
            } | null>).detail;
            setActiveOrderPane(detail || null);
            if (detail) setPreviewOrder(null);
        };
        window.addEventListener('tech-active-order-changed', handler);
        return () => window.removeEventListener('tech-active-order-changed', handler);
    }, []);

    // Listen for Up Next card clicks — preview an order in the right pane.
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<UpNextPreviewPayload>).detail;
            if (detail && detail.kind === 'order') {
                setPreviewOrder(detail.order);
            } else {
                setPreviewOrder(null);
            }
        };
        window.addEventListener('tech-upnext-preview', handler);
        return () => window.removeEventListener('tech-upnext-preview', handler);
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

    /**
     * Right pane swaps by sidebar mode. The shipping sub-page tabs
     * (shipped / pending / history) share ONE AnimatePresence so a scanned /
     * active order — or an Up Next preview — crossfades OVER whichever tab table
     * is showing, then crossfades back to that same tab when the order clears.
     * Because scanning no longer changes the tab, "back" is always the tab the
     * tech was on before the order took over. Receiving and testing modes own
     * their own surfaces and never take an order overlay.
     */
    let rightPane: React.ReactNode;
    if (rightViewMode === 'receiving') {
        rightPane = <ReceivingInboundFeed onSelectLog={setSelectedLog} />;
    } else if (rightViewMode === 'testing') {
        // Testing sub-page — composes receiving form primitives with the
        // Pass/Test Again/Testing Failed verdict pills and a unit-label print path.
        rightPane = (
            <TechTestingWorkspace
                staffId={techId}
                selectedLineId={testingLineId}
                onSelectedLineChange={setTestingLineId}
            />
        );
    } else {
        // Shipping sub-page: shipped | pending | history. Keyed by tab so tab
        // switches also crossfade; the active/preview order overlays them all.
        const tabTable =
            rightViewMode === 'pending' ? (
                <PendingOrdersTable />
            ) : rightViewMode === 'shipped' ? (
                <DashboardShippedTable testedBy={parseInt(techId)} />
            ) : (
                <TechTable testedBy={parseInt(techId)} />
            );
        rightPane = (
            <AnimatePresence initial={false} mode="wait">
                {activeOrderPane ? (
                    <ActiveOrderWorkspace
                        key={`workspace-active-${activeOrderPane.activeOrder.tracking || activeOrderPane.activeOrder.orderId}`}
                        activeOrder={activeOrderPane.activeOrder}
                        onClose={() => setActiveOrderPane(null)}
                    />
                ) : previewOrder ? (
                    <ActiveOrderWorkspace
                        key={`workspace-preview-${previewOrder.id}`}
                        activeOrder={previewOrderToActiveShape(previewOrder)}
                        mode="preview"
                        previewOrder={previewOrder}
                        onClose={() => setPreviewOrder(null)}
                    />
                ) : (
                    <motion.div
                        key={`tech-tab-${rightViewMode}`}
                        initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.16 }}
                        className="h-full w-full"
                    >
                        {tabTable}
                    </motion.div>
                )}
            </AnimatePresence>
        );
    }

    return (
        <div className="relative flex h-full w-full flex-col">
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="relative min-h-0 flex-1 overflow-hidden">
                    {rightPane}
                </div>
            </div>

            <StationDetailsHandler
                viewMode={
                    rightViewMode === 'receiving' || rightViewMode === 'testing'
                        ? 'history'
                        : rightViewMode
                }
            />

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
