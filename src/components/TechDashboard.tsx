'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { TechTable } from './TechTable';
import { TestingHistoryList, TESTING_SELECTION_SCOPE } from './tech/TestingHistoryList';
import { usePageSelection } from '@/hooks/usePageHeader';
import { useTableSelection } from '@/hooks/useTableSelection';
import { emitToggleAll } from '@/lib/selection/table-selection';
import { ContextualSelectionBar } from '@/design-system/components/ContextualSelectionBar';
import type { SelectionAction } from '@/lib/selection/selection-actions';
import { ReceivingClaimModal } from './receiving/workspace/ReceivingClaimModal';
import { printProductLabel, printProductLabels } from '@/lib/print/printProductLabel';
import { Copy, Printer, MessageSquare, User, Smartphone } from '@/components/Icons';
import { toast } from '@/lib/toast';
import type { ReceivingLineRow } from './station/ReceivingLinesTable';
import { StationDetailsHandler } from './station/StationDetailsHandler';
import { ReceivingInboundFeed } from './station/ReceivingInboundFeed';
import { ReceivingDetailsStack, type ReceivingDetailsLog } from './station/ReceivingDetailsStack';
import { RepairDetailsPanel } from './repair/RepairDetailsPanel';
import { ActiveOrderWorkspace } from './tech/ActiveOrderWorkspace';
import { TestingLineWorkspace } from './tech/TestingLineWorkspace';
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
    // Shipping mode's right pane is fixed to the History feed — the legacy
    // `shipped`/`pending` sub-tabs were removed. `testing-history` is the
    // tested-lines browse feed (promoted from a sub-tab to its own top mode).
    // Anything else falls through to the shipping History feed.
    const rightViewMode = rawView === 'receiving'
        ? 'receiving'
        : rawView === 'testing'
            ? 'testing'
            : rawView === 'testing-history'
                ? 'testing-history'
                : 'history';
    const router = useRouter();
    const isTestingHistory = rightViewMode === 'testing-history';

    // ── Testing-history bulk selection ──────────────────────────────────────
    const [testingSelectMode, setTestingSelectMode] = useState(false);
    const testingSelectedRows = useTableSelection<ReceivingLineRow>(
        TESTING_SELECTION_SCOPE,
        (r) => r.id,
    );
    // Single-line claim modal opened from the bulk bar's "Create support ticket".
    const [testingClaimRow, setTestingClaimRow] = useState<ReceivingLineRow | null>(null);

    // Exit select mode whenever we leave the testing-history surface.
    useEffect(() => {
        if (!isTestingHistory && testingSelectMode) setTestingSelectMode(false);
    }, [isTestingHistory, testingSelectMode]);

    const exitTestingSelect = useCallback(() => {
        emitToggleAll(TESTING_SELECTION_SCOPE, 'none');
        setTestingSelectMode(false);
    }, []);

    const openTestingLine = useCallback(() => {
        // Clicking a history row opens it in the workspace → switch to the
        // Testing mode (Recent workspace).
        const params = new URLSearchParams(searchParams.toString());
        params.set('view', 'testing');
        router.replace(`/tech?${params.toString()}`);
    }, [router, searchParams]);

    const handleCopyTestingDetails = useCallback((rows: ReceivingLineRow[]) => {
        const text = rows
            .map((r) => {
                const sku = (r.sku || '').trim();
                const serials = (r.serials ?? [])
                    .map((s) => (s.serial_number || '').trim())
                    .filter(Boolean)
                    .join('/');
                const po = (r.zoho_purchaseorder_number || r.zoho_purchaseorder_id || '').trim();
                return [sku && `SKU ${sku}`, serials && `SN ${serials}`, po && `PO ${po}`]
                    .filter(Boolean)
                    .join(' • ');
            })
            .filter(Boolean)
            .join('\n');
        void navigator.clipboard?.writeText(text).then(
            () => toast.success(`Copied ${rows.length} line${rows.length === 1 ? '' : 's'}`),
            () => toast.error('Copy failed'),
        );
    }, []);

    // Print one tested-unit label per selected line — serial-level when serials
    // are loaded, else a single SKU label. Same pipeline as Pass + Print.
    const handlePrintTestingLabels = useCallback((rows: ReceivingLineRow[]) => {
        let printed = 0;
        for (const r of rows) {
            const sku = (r.sku || '').trim();
            if (!sku) continue;
            const serials = (r.serials ?? [])
                .map((s) => (s.serial_number || '').trim())
                .filter(Boolean);
            if (serials.length > 0) {
                printProductLabels({ sku, serialNumbers: serials });
                printed += serials.length;
            } else {
                printProductLabel({ sku });
                printed += 1;
            }
        }
        if (printed > 0) toast.success(`Printing ${printed} label${printed === 1 ? '' : 's'}`);
        else toast.error('No SKU on the selected line(s)');
    }, []);

    // Contextual bulk actions for the testing-history selection. Mirrors the
    // receiving-history set; declared as a SelectionAction[] so the bar derives
    // the CTA + overflow menu + disabled states (see ContextualSelectionBar).
    const testingBulkActions = useMemo<SelectionAction<ReceivingLineRow>[]>(
        () => [
            {
                key: 'copy',
                label: 'Copy details',
                icon: <Copy className="h-4 w-4" />,
                tone: 'blue',
                primary: true,
                run: handleCopyTestingDetails,
            },
            {
                key: 'print',
                label: 'Print labels',
                icon: <Printer className="h-4 w-4" />,
                run: handlePrintTestingLabels,
            },
            {
                key: 'ticket',
                label: 'Create support ticket',
                icon: <MessageSquare className="h-4 w-4" />,
                maxSelected: 1,
                disabledReason: 'Select a single line to file a ticket',
                run: (rows) => {
                    if (rows[0]) setTestingClaimRow(rows[0]);
                },
            },
            {
                key: 'staff',
                label: 'Send to staff',
                icon: <User className="h-4 w-4" />,
                enabled: () => false,
                disabledReason: 'Coming next — needs assignment backend',
                run: () => {
                    /* disabled until the backend lands */
                },
            },
            {
                key: 'phone',
                label: 'Send to phone',
                icon: <Smartphone className="h-4 w-4" />,
                enabled: () => false,
                disabledReason: 'Coming next — needs phone push channel',
                run: () => {
                    /* disabled until the backend lands */
                },
            },
        ],
        [handleCopyTestingDetails, handlePrintTestingLabels],
    );

    // Selection toggle — surfaced as the pencil in the global header's right
    // actions while testing history is up. No page title in the header.
    usePageSelection(
        isTestingHistory
            ? {
                  active: testingSelectMode,
                  onToggle: () =>
                      testingSelectMode ? exitTestingSelect() : setTestingSelectMode(true),
              }
            : null,
        [isTestingHistory, testingSelectMode, exitTestingSelect],
    );

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
        // Testing mode → the Pass/Test-Again verdict workspace.
        rightPane = (
            <TestingLineWorkspace
                staffId={techId}
                selectedLineId={testingLineId}
                onSelectedLineChange={setTestingLineId}
            />
        );
    } else if (rightViewMode === 'testing-history') {
        // History mode → the browse + bulk-select feed of this tech's tested lines.
        rightPane = (
            <TestingHistoryList
                staffId={techId}
                selectMode={testingSelectMode}
                onOpenLine={openTestingLine}
            />
        );
    } else {
        // Shipping mode: the right pane is always the tech's History feed; the
        // active/preview order crossfades over it and back.
        const tabTable = <TechTable testedBy={parseInt(techId)} />;
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
                    {isTestingHistory ? (
                        <ContextualSelectionBar
                            scope={TESTING_SELECTION_SCOPE}
                            rows={testingSelectedRows}
                            actions={testingBulkActions}
                        />
                    ) : null}
                </div>
            </div>

            <StationDetailsHandler viewMode="history" />

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
                <div className="fixed inset-0 bg-black/20 z-panelBackdrop flex items-center justify-center pointer-events-none">
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

            {testingClaimRow ? (
                <ReceivingClaimModal
                    open
                    row={testingClaimRow}
                    onClose={() => setTestingClaimRow(null)}
                    onTicketCreated={(tk) => {
                        toast.success(`Claim filed — ${tk}`);
                        setTestingClaimRow(null);
                        exitTestingSelect();
                    }}
                />
            ) : null}
        </div>
    );
}
