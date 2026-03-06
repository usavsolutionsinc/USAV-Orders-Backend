'use client';

import { Suspense, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { DashboardShippedTable, ShippedDetailsPanel } from '@/components/shipped';
import PendingOrdersTable from '@/components/PendingOrdersTable';
import { UnshippedDetailsPanel } from '@/components/unshipped/UnshippedDetailsPanel';
import { UnshippedTable } from '@/components/unshipped/UnshippedTable';
import FBAShipmentsTable from '@/components/dashboard/FBAShipmentsTable';
import { Loader2 } from '@/components/Icons';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import {
  fetchDashboardShippedData,
  fetchPendingOrdersData,
  fetchUnshippedOrdersData,
} from '@/lib/dashboard-table-data';

type DashboardOrderView = 'pending' | 'unshipped' | 'shipped' | 'fba';

const getOrderViewFromSearch = (search: string): DashboardOrderView => {
    const params = new URLSearchParams(search);
    if (params.has('unshipped')) return 'unshipped';
    if (params.has('pending')) return 'pending';
    if (params.has('shipped')) return 'shipped';
    if (params.has('fba')) return 'fba';
    return 'pending';
};

function DashboardPageContent() {
    const searchParams = useSearchParams();
    const queryClient = useQueryClient();
    const [selectedShipped, setSelectedShipped] = useState<ShippedOrder | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const orderView = getOrderViewFromSearch(searchParams.toString());
    useRealtimeInvalidation({ dashboard: true });

    useEffect(() => {
        const handleOpen = (e: CustomEvent<ShippedOrder>) => {
            if (e.detail) setSelectedShipped(e.detail);
        };
        const handleClose = () => setSelectedShipped(null);

        window.addEventListener('open-shipped-details' as any, handleOpen as any);
        window.addEventListener('close-shipped-details' as any, handleClose as any);

        return () => {
            window.removeEventListener('open-shipped-details' as any, handleOpen as any);
            window.removeEventListener('close-shipped-details' as any, handleClose as any);
        };
    }, []);

    useEffect(() => {
        const STALE = 5 * 60 * 1000;

        // Prefetch the active view immediately so it loads as fast as possible.
        const prefetchActive = () => {
            if (orderView === 'pending') {
                queryClient.prefetchQuery({
                    queryKey: ['dashboard-table', 'pending', { searchQuery: '', packedBy: undefined, testedBy: undefined }],
                    queryFn: () => fetchPendingOrdersData({}),
                    staleTime: STALE,
                });
            } else if (orderView === 'unshipped') {
                queryClient.prefetchQuery({
                    queryKey: ['dashboard-table', 'unshipped', { searchQuery: '', packedBy: undefined, testedBy: undefined }],
                    queryFn: () => fetchUnshippedOrdersData({}),
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
                    queryKey: ['dashboard-table', 'shipped', { search: '', packedBy: undefined, testedBy: undefined }],
                    queryFn: () => fetchDashboardShippedData({}),
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
            if (orderView !== 'fba') {
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
            }
        }, 400);

        return () => clearTimeout(timer);
    }, [queryClient, orderView]);

    useEffect(() => {
        const handleRefresh = () => setRefreshKey((prev) => prev + 1);
        window.addEventListener('dashboard-refresh', handleRefresh as any);
        window.addEventListener('usav-refresh-data', handleRefresh as any);
        return () => {
            window.removeEventListener('dashboard-refresh', handleRefresh as any);
            window.removeEventListener('usav-refresh-data', handleRefresh as any);
        };
    }, []);

    return (
        <div className="flex h-full w-full">
            <Suspense fallback={
                <div className="flex-1 flex items-center justify-center bg-gray-50">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                </div>
            }>
                {orderView === 'shipped' ? (
                    <DashboardShippedTable key={`shipped-${refreshKey}`} />
                ) : orderView === 'unshipped' ? (
                    <UnshippedTable key={`unshipped-${refreshKey}`} />
                ) : orderView === 'fba' ? (
                    <FBAShipmentsTable key={`fba-${refreshKey}`} />
                ) : (
                    <PendingOrdersTable key={`pending-${refreshKey}`} />
                )}
            </Suspense>

            <AnimatePresence>
                {selectedShipped && (
                    orderView === 'unshipped' ? (
                        <UnshippedDetailsPanel
                            shipped={selectedShipped}
                            onClose={() => {
                                window.dispatchEvent(new CustomEvent('close-shipped-details'));
                                setSelectedShipped(null);
                            }}
                            onUpdate={() => {
                                window.dispatchEvent(new CustomEvent('dashboard-refresh'));
                            }}
                        />
                    ) : (
                        <ShippedDetailsPanel
                            shipped={selectedShipped}
                            context={orderView === 'shipped' ? 'shipped' : 'dashboard'}
                            onClose={() => {
                                window.dispatchEvent(new CustomEvent('close-shipped-details'));
                                setSelectedShipped(null);
                            }}
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
