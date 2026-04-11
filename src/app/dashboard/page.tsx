'use client';

import { Suspense, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { DashboardShippedTable, ShippedDetailsPanel } from '@/components/shipped';
import PendingOrdersTable from '@/components/PendingOrdersTable';
import { UnshippedDetailsPanel } from '@/components/unshipped/UnshippedDetailsPanel';
import { UnshippedTable } from '@/components/unshipped/UnshippedTable';
import FBAShipmentsTable from '@/components/dashboard/FBAShipmentsTable';
import { ShippingEditCard } from '@/components/shipping/ShippingEditCard';
import { useShippingEditCard } from '@/hooks/useShippingEditCard';
import { Loader2 } from '@/components/Icons';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { useFbaRealtimeInvalidation } from '@/hooks/useFbaRealtimeInvalidation';
import { useRealtimeToasts } from '@/hooks/useRealtimeToasts';
import { useAblyReconnectInvalidation } from '@/hooks/useAblyReconnectInvalidation';
import { useDashboardSearchController } from '@/hooks/useDashboardSearchController';
import { useDashboardSelectedOrder } from '@/hooks/useDashboardSelectedOrder';
import {
  fetchDashboardShippedData,
  fetchPendingOrdersData,
  fetchUnshippedOrdersData,
} from '@/lib/dashboard-table-data';

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
    const shippingCard = useShippingEditCard();
    useRealtimeInvalidation({ dashboard: true });
    useFbaRealtimeInvalidation();
    useRealtimeToasts('admin');
    useAblyReconnectInvalidation();

    useEffect(() => {
        const STALE = 5 * 60 * 1000;

        // Prefetch the active view immediately so it loads as fast as possible.
        const prefetchActive = () => {
            if (orderView === 'pending') {
                queryClient.prefetchQuery({
                    queryKey: ['dashboard-table', 'pending', { searchQuery, packedBy: undefined, testedBy: undefined, strictSearchScope: true }],
                    queryFn: () => fetchPendingOrdersData({ searchQuery, strictSearchScope: true }),
                    staleTime: STALE,
                });
            } else if (orderView === 'unshipped') {
                queryClient.prefetchQuery({
                    queryKey: ['dashboard-table', 'unshipped', { searchQuery, packedBy: undefined, testedBy: undefined, strictSearchScope: true }],
                    queryFn: () => fetchUnshippedOrdersData({ searchQuery, strictSearchScope: true }),
                    staleTime: STALE,
                });
            } else if (orderView === 'fba') {
                queryClient.prefetchQuery({
                    queryKey: ['dashboard-fba-shipments'],
                    queryFn: async () => {
                        const res = await fetch('/api/dashboard/fba-shipments?limit=500', { cache: 'no-store' });
                        if (!res.ok) throw new Error('Failed to fetch FBA shipments');
                        const json = await res.json();
                        return json?.rows || [];
                    },
                    staleTime: STALE,
                });
            } else {
                // shipped view — no weekStart/weekEnd here; DashboardShippedTable
                // will supply those once it mounts.
                queryClient.prefetchQuery({
                    queryKey: ['dashboard-table', 'shipped', { search: searchQuery, packedBy: undefined, testedBy: undefined }],
                    queryFn: () => fetchDashboardShippedData({ searchQuery }),
                    staleTime: STALE,
                });
            }
        };

        prefetchActive();

        // Warm the inactive tabs after a short idle delay so navigation between
        // tabs feels instant without competing with the initial page render.
        const timer = setTimeout(() => {
            if (orderView !== 'pending') {
                queryClient.prefetchQuery({
                    queryKey: ['dashboard-table', 'pending', { searchQuery: '', packedBy: undefined, testedBy: undefined }],
                    queryFn: () => fetchPendingOrdersData({}),
                    staleTime: STALE,
                });
            }
            if (orderView !== 'unshipped') {
                queryClient.prefetchQuery({
                    queryKey: ['dashboard-table', 'unshipped', { searchQuery: '', packedBy: undefined, testedBy: undefined }],
                    queryFn: () => fetchUnshippedOrdersData({}),
                    staleTime: STALE,
                });
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
                            context="shipped"
                            onClose={requestCloseSelectedOrder}
                            onUpdate={() => {
                                window.dispatchEvent(new CustomEvent('dashboard-refresh'));
                            }}
                        />
                    )
                )}
            </AnimatePresence>

            {shippingCard.isOpen && (
                <ShippingEditCard
                    orders={shippingCard.orders}
                    startIndex={shippingCard.startIndex}
                    onClose={shippingCard.close}
                    onUpdate={() => {
                        window.dispatchEvent(new CustomEvent('dashboard-refresh'));
                    }}
                    storageKey="dashboard"
                />
            )}
        </div>
    );
}

export default function DashboardPage() {
    return (
        <Suspense fallback={
            <div className="flex h-full w-full items-center justify-center bg-gray-50">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        }>
            <DashboardPageContent />
        </Suspense>
    );
}
