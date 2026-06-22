'use client';

/**
 * Dashboard page — thin composition layer.
 *
 * Logic lives in focused hooks:
 *   - useDashboardSearchController .. URL ⇄ active view + search (existing)
 *   - useDashboardSelectedOrder ..... selected order + details context (existing)
 *   - useDashboardBulkSelection ..... pencil multi-select + Copy/Print/Delete
 *   - useDashboardViewWarmup ........ React Query prefetch warm-up
 *   - useDashboardRealtime .......... realtime invalidation + toasts
 *
 * Render is pure composition: <DashboardOrdersView> (table + selection bar) and
 * <DashboardOrderDetails> (the slide-in panel). The sign-in BootGate reuses the
 * shared `warmActiveView` warm-up so the splash holds until data is painted.
 */

import { Suspense, useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { BootGate } from '@/components/boot/BootGate';
import { BootSplash } from '@/components/boot/BootSplash';
import { consumeBootSplash } from '@/lib/boot-flag';
import { warmActiveView } from '@/lib/queries/dashboard-warm';
import { useDashboardSearchController } from '@/hooks/useDashboardSearchController';
import { useDashboardSelectedOrder } from '@/hooks/useDashboardSelectedOrder';
import { useDashboardBulkSelection } from '@/hooks/useDashboardBulkSelection';
import { useDashboardViewWarmup } from '@/hooks/useDashboardViewWarmup';
import { useDashboardRealtime } from '@/hooks/useDashboardRealtime';
import { DashboardOrdersView } from '@/components/dashboard/DashboardOrdersView';
import { DashboardOrderDetails } from '@/components/dashboard/DashboardOrderDetails';

function DashboardPageContent() {
  const { detailsEnabled, orderView, searchQuery } = useDashboardSearchController();

  const { selectionEnabled, selectMode, selectedRows, selectionActions } =
    useDashboardBulkSelection(orderView);

  const { selectedShipped, selectedContext, requestCloseSelectedOrder } =
    useDashboardSelectedOrder(detailsEnabled);

  useDashboardRealtime();
  useDashboardViewWarmup({ orderView, searchQuery });

  const refreshDashboard = useCallback(() => {
    window.dispatchEvent(new CustomEvent('dashboard-refresh'));
  }, []);

  return (
    <div className="flex h-full w-full">
      <DashboardOrdersView
        orderView={orderView}
        selectMode={selectMode}
        selectionEnabled={selectionEnabled}
        selectedRows={selectedRows}
        selectionActions={selectionActions}
      />

      <DashboardOrderDetails
        detailsEnabled={detailsEnabled}
        selectedShipped={selectedShipped}
        selectedContext={selectedContext}
        onClose={requestCloseSelectedOrder}
        onUpdate={refreshDashboard}
      />
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
