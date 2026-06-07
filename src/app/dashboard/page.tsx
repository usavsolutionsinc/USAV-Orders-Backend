'use client';

import { Suspense, useCallback, useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { DashboardShippedTable, ShippedDetailsPanel } from '@/components/shipped';
import PendingOrdersTable from '@/components/PendingOrdersTable';
import { UnshippedDetailsPanel } from '@/components/unshipped/UnshippedDetailsPanel';
import { UnshippedTable } from '@/components/unshipped/UnshippedTable';
import FBAShipmentsTable from '@/components/dashboard/FBAShipmentsTable';
import { WarrantyWorkspace } from '@/components/warranty/WarrantyWorkspace';
import { Loader2 } from '@/components/Icons';
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
  pendingOrdersQuery,
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
  return queryClient.prefetchQuery(pendingOrdersQuery({ searchQuery, strictSearchScope: true }));
}

function DashboardPageContent() {
    const queryClient = useQueryClient();
    const {
        detailsEnabled,
        orderView,
        searchQuery,
    } = useDashboardSearchController();
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

        // Warm the inactive order tabs after a short idle delay so switching
        // between them feels instant without competing with the active render.
        // strictSearchScope mirrors how the dashboard mounts these tables.
        const timer = setTimeout(() => {
            if (orderView !== 'pending') {
                void queryClient.prefetchQuery(pendingOrdersQuery({ strictSearchScope: true }));
            }
            if (orderView !== 'unshipped') {
                void queryClient.prefetchQuery(unshippedOrdersQuery({ strictSearchScope: true }));
            }
        }, 400);

        return () => clearTimeout(timer);
    }, [queryClient, orderView, searchQuery]);

    return (
        <div className="flex h-full w-full">
            <Suspense fallback={
                <div className="flex-1 flex items-center justify-center bg-gray-50">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                </div>
            }>
                {orderView === 'shipped' ? (
                    <DashboardShippedTable />
                ) : orderView === 'unshipped' ? (
                    <UnshippedTable strictSearchScope />
                ) : orderView === 'fba' ? (
                    <FBAShipmentsTable />
                ) : orderView === 'warranty' ? (
                    <WarrantyWorkspace />
                ) : (
                    <PendingOrdersTable strictSearchScope />
                )}
            </Suspense>

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
