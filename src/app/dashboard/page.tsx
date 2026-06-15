'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { DashboardShippedTable, ShippedDetailsPanel } from '@/components/shipped';
import { UnshippedDetailsPanel } from '@/components/unshipped/UnshippedDetailsPanel';
import { UnshippedTable } from '@/components/unshipped/UnshippedTable';
import FBAShipmentsTable from '@/components/dashboard/FBAShipmentsTable';
import { WarrantyWorkspace } from '@/components/warranty/WarrantyWorkspace';
import { Copy, Loader2, Printer, Smartphone, Trash2, User } from '@/components/Icons';
import { ContextualSelectionBar } from '@/design-system/components/ContextualSelectionBar';
import { usePageSelection } from '@/hooks/usePageHeader';
import { useTableSelection } from '@/hooks/useTableSelection';
import { useDeleteOrderRow } from '@/hooks/useDeleteOrderRow';
import { emitToggleAll } from '@/lib/selection/table-selection';
import { DASHBOARD_ORDERS_SELECTION_SCOPE } from '@/lib/selection/dashboard-scopes';
import type { SelectionAction } from '@/lib/selection/selection-actions';
import { printProductLabel, printProductLabels } from '@/lib/print/printProductLabel';
import { toast } from '@/lib/toast';
import { BootGate } from '@/components/boot/BootGate';
import { BootSplash } from '@/components/boot/BootSplash';
import { consumeBootSplash } from '@/lib/boot-flag';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { useFbaRealtimeInvalidation } from '@/hooks/useFbaRealtimeInvalidation';
import { useRealtimeToasts } from '@/hooks/useRealtimeToasts';
import { useDashboardSearchController } from '@/hooks/useDashboardSearchController';
import { useDashboardSelectedOrder } from '@/hooks/useDashboardSelectedOrder';
import { getDashboardOrderViewFromSearch } from '@/utils/dashboard-search-state';
import { getWeekRangeForOffset } from '@/lib/dashboard-week-range';
import { readShippedFilterPreference } from '@/utils/dashboard-preferences';
import {
  unshippedOrdersQuery,
  dashboardShippedQuery,
  fbaShipmentsQuery,
  warrantyClaimsQuery,
} from '@/lib/queries/dashboard-queries';
import { WARRANTY_EXPIRING_SOON_DAYS } from '@/hooks/useWarrantyClaims';
import { isWarrantyClaimStatus } from '@/lib/warranty/types';

/**
 * Warm the active dashboard view's data into the React Query cache. Shared by
 * the page-level warm-up effect and the sign-in BootGate so a prefetch and the
 * table that later mounts always hit the same cache key (the factories are the
 * single source of truth). `shippedFilter` falls back to the stored preference,
 * matching how `DashboardShippedTable` resolves it. Returns a promise that
 * settles when the active view is ready.
 */
function warmActiveView(queryClient: QueryClient, searchParamsString: string): Promise<unknown> {
  const sp = new URLSearchParams(searchParamsString);
  const view = getDashboardOrderViewFromSearch(sp);
  const searchQuery = String(sp.get('search') || '').trim();

  if (view === 'unshipped') {
    return queryClient.prefetchQuery(unshippedOrdersQuery({ searchQuery, strictSearchScope: true }));
  }
  if (view === 'fba') {
    return queryClient.prefetchQuery(fbaShipmentsQuery());
  }
  if (view === 'warranty') {
    const wstatus = sp.get('wstatus');
    return queryClient.prefetchQuery(
      warrantyClaimsQuery({
        status: isWarrantyClaimStatus(wstatus) ? wstatus : null,
        search: searchQuery,
        expiringWithinDays: sp.get('wexp') === '1' ? WARRANTY_EXPIRING_SOON_DAYS : null,
      }),
    );
  }
  if (view === 'shipped') {
    const week = getWeekRangeForOffset(0);
    const shippedFilter = sp.get('shippedFilter') || readShippedFilterPreference() || 'all';
    return queryClient.prefetchQuery(
      dashboardShippedQuery({ weekStart: week.startStr, weekEnd: week.endStr, shippedFilter }),
    );
  }
  // Default + legacy `?pending` → the merged Unshipped backlog.
  return queryClient.prefetchQuery(unshippedOrdersQuery({ searchQuery, strictSearchScope: true }));
}

/** Minimal shape the dashboard selection bar needs from a row — satisfied by
 *  both the Unshipped (`ShippedOrder`) and Shipped (`PackerRecord`) records. */
type DashSelectableRow = {
    id: number | string;
    order_id?: string | null;
    sku?: string | null;
    serial_number?: string | null;
    shipping_tracking_number?: string | null;
    tracking_number?: string | null;
    packer_log_id?: number | null;
};

function DashboardPageContent() {
    const queryClient = useQueryClient();
    const {
        detailsEnabled,
        orderView,
        searchQuery,
    } = useDashboardSearchController();

    // ── Pencil multi-select ────────────────────────────────────────────────
    // The Unshipped + Shipped tables share one selection scope (only one mounts
    // per `?view`). FBA + Warranty opt out. The pencil lives in the global
    // header (usePageSelection); the bar + bulk actions live here.
    const selectionEnabled = orderView !== 'fba' && orderView !== 'warranty';
    const isShippedView = orderView === 'shipped';
    const [selectMode, setSelectMode] = useState(false);
    const selectedRows = useTableSelection<DashSelectableRow>(
        DASHBOARD_ORDERS_SELECTION_SCOPE,
        (r) => Number(r.id),
    );
    const deleteOrderRow = useDeleteOrderRow();

    const exitSelectMode = useCallback(() => {
        emitToggleAll(DASHBOARD_ORDERS_SELECTION_SCOPE, 'none');
        setSelectMode(false);
    }, []);

    // Switching view (or losing the selectable surface) exits select mode so a
    // stale pencil never lingers on FBA/Warranty.
    useEffect(() => {
        if (!selectionEnabled && selectMode) exitSelectMode();
    }, [selectionEnabled, selectMode, exitSelectMode]);
    useEffect(() => {
        // Reset on any view flip — the row types + delete semantics differ.
        setSelectMode(false);
    }, [orderView]);

    usePageSelection(
        selectionEnabled
            ? { active: selectMode, onToggle: () => (selectMode ? exitSelectMode() : setSelectMode(true)) }
            : null,
        [selectionEnabled, selectMode, exitSelectMode],
    );

    const handleCopyDetails = useCallback((rows: DashSelectableRow[]) => {
        const text = rows
            .map((r) => {
                const order = String(r.order_id || '').trim();
                const sku = String(r.sku || '').trim();
                const tracking = String(r.shipping_tracking_number || r.tracking_number || '').trim();
                const serial = String(r.serial_number || '').trim();
                return [order && `Order ${order}`, sku && `SKU ${sku}`, tracking && `TRK ${tracking}`, serial && `SN ${serial}`]
                    .filter(Boolean)
                    .join(' • ');
            })
            .filter(Boolean)
            .join('\n');
        if (!text) {
            toast.error('Nothing to copy on the selected row(s)');
            return;
        }
        void navigator.clipboard?.writeText(text).then(
            () => toast.success(`Copied ${rows.length} row${rows.length === 1 ? '' : 's'}`),
            () => toast.error('Copy failed'),
        );
    }, []);

    const handlePrintLabels = useCallback((rows: DashSelectableRow[]) => {
        let printed = 0;
        for (const r of rows) {
            const sku = String(r.sku || '').trim();
            if (!sku) continue;
            const serial = String(r.serial_number || '').trim();
            if (serial) printProductLabels({ sku, serialNumbers: [serial] });
            else printProductLabel({ sku });
            printed += 1;
        }
        if (printed > 0) toast.success(`Printing ${printed} label${printed === 1 ? '' : 's'}`);
        else toast.error('No SKU on the selected row(s)');
    }, []);

    const handleDelete = useCallback(async (rows: DashSelectableRow[]) => {
        if (rows.length === 0) return;
        const noun = isShippedView ? 'shipped record' : 'order';
        const label = rows.length === 1 ? `this ${noun}` : `these ${rows.length} ${noun}s`;
        if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
        try {
            if (isShippedView) {
                // No bulk packer-log endpoint — delete each (the Shipped row id IS
                // its station_activity_log id; packer_log_id is the fallback key).
                const results = await Promise.allSettled(
                    rows.map((r) =>
                        deleteOrderRow.mutateAsync({
                            rowSource: 'packing_log',
                            activityLogId: Number(r.id),
                            packerLogId: r.packer_log_id ?? undefined,
                        }),
                    ),
                );
                const failed = results.filter((x) => x.status === 'rejected').length;
                if (failed > 0) toast.error(`${failed} of ${rows.length} could not be deleted`);
                else toast.success(rows.length === 1 ? 'Record deleted' : `${rows.length} records deleted`);
            } else {
                const orderIds = rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
                await deleteOrderRow.mutateAsync({ rowSource: 'order', orderIds });
                toast.success(orderIds.length === 1 ? 'Order deleted' : `${orderIds.length} orders deleted`);
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Delete failed');
        } finally {
            exitSelectMode();
            window.dispatchEvent(new CustomEvent('dashboard-refresh'));
        }
    }, [isShippedView, deleteOrderRow, exitSelectMode]);

    const selectionActions = useMemo<SelectionAction<DashSelectableRow>[]>(
        () => [
            { key: 'copy', label: 'Copy details', icon: <Copy className="h-4 w-4" />, tone: 'blue', primary: true, run: handleCopyDetails },
            { key: 'print', label: 'Print labels', icon: <Printer className="h-4 w-4" />, run: handlePrintLabels },
            { key: 'staff', label: 'Send to staff', icon: <User className="h-4 w-4" />, run: () => toast('Send to staff — coming next') },
            { key: 'phone', label: 'Send to phone', icon: <Smartphone className="h-4 w-4" />, run: () => toast('Send to phone — coming next') },
            { key: 'delete', label: 'Delete', icon: <Trash2 className="h-4 w-4" />, tone: 'red', run: handleDelete },
        ],
        [handleCopyDetails, handlePrintLabels, handleDelete],
    );

    const {
        selectedShipped,
        selectedContext,
        requestCloseSelectedOrder,
    } = useDashboardSelectedOrder(detailsEnabled);
    useRealtimeInvalidation({ dashboard: true, reconnect: true });
    useFbaRealtimeInvalidation();
    useRealtimeToasts('admin');

    useEffect(() => {
        // Prefetch the active view immediately so it loads as fast as possible.
        // Same factories as the BootGate and the tables → guaranteed cache hit.
        void warmActiveView(queryClient, window.location.search);

        // Warm the merged Unshipped backlog after a short idle delay so landing
        // on another tab and switching back feels instant. strictSearchScope
        // mirrors how the dashboard mounts the table.
        const timer = setTimeout(() => {
            if (orderView !== 'unshipped') {
                void queryClient.prefetchQuery(unshippedOrdersQuery({ strictSearchScope: true }));
            }
        }, 400);

        return () => clearTimeout(timer);
    }, [queryClient, orderView, searchQuery]);

    return (
        <div className="flex h-full w-full">
            <div className="relative flex min-w-0 flex-1 overflow-hidden">
                <Suspense fallback={
                    <div className="flex-1 flex items-center justify-center bg-gray-50">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                }>
                    {orderView === 'shipped' ? (
                        <DashboardShippedTable selectMode={selectMode} />
                    ) : orderView === 'fba' ? (
                        <FBAShipmentsTable />
                    ) : orderView === 'warranty' ? (
                        <WarrantyWorkspace />
                    ) : (
                        // 'unshipped' (the merged pre-ship backlog) + the default.
                        <UnshippedTable strictSearchScope selectMode={selectMode} />
                    )}
                </Suspense>

                {/* Bulk-action capsule — pins to the bottom of the table region
                    when rows are checked in the Unshipped / Shipped tables. */}
                {selectionEnabled ? (
                    <ContextualSelectionBar
                        scope={DASHBOARD_ORDERS_SELECTION_SCOPE}
                        rows={selectedRows}
                        actions={selectionActions}
                    />
                ) : null}
            </div>

            <AnimatePresence>
                {detailsEnabled && selectedShipped && (
                    selectedContext === 'queue' ? (
                        <UnshippedDetailsPanel
                            shipped={selectedShipped}
                            onClose={requestCloseSelectedOrder}
                            onUpdate={() => {
                                window.dispatchEvent(new CustomEvent('dashboard-refresh'));
                            }}
                        />
                    ) : (
                        <ShippedDetailsPanel
                            shipped={selectedShipped}
                            context="dashboard"
                            onClose={requestCloseSelectedOrder}
                            onUpdate={() => {
                                window.dispatchEvent(new CustomEvent('dashboard-refresh'));
                            }}
                        />
                    )
                )}
            </AnimatePresence>
        </div>
    );
}

/**
 * Wraps the dashboard in a single sign-in loading splash. On a fresh sign-in
 * (flag armed by /signin), the splash holds while the active view's data is
 * warmed, then reveals the page fully painted. On refreshes / in-app
 * navigations the gate reveals immediately, so it never lingers.
 */
function DashboardBootGate({ children }: { children: React.ReactNode }) {
    const prefetch = useCallback(
        (queryClient: QueryClient) => warmActiveView(queryClient, window.location.search),
        [],
    );
    return (
        <BootGate prefetch={prefetch} shouldHold={consumeBootSplash} splash={<BootSplash />}>
            {children}
        </BootGate>
    );
}

export default function DashboardPage() {
    return (
        <Suspense fallback={<BootSplash />}>
            <DashboardBootGate>
                <DashboardPageContent />
            </DashboardBootGate>
        </Suspense>
    );
}
