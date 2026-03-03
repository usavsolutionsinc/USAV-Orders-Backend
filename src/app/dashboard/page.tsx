'use client';

import { Suspense, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { DashboardShippedTable, ShippedDetailsPanel } from '@/components/shipped';
import PendingOrdersTable from '@/components/PendingOrdersTable';
import { UnshippedDetailsPanel } from '@/components/unshipped/UnshippedDetailsPanel';
import { UnshippedTable } from '@/components/unshipped/UnshippedTable';
import { Loader2 } from '@/components/Icons';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import {
  fetchDashboardShippedData,
  fetchPendingOrdersData,
  fetchUnshippedOrdersData,
} from '@/lib/dashboard-table-data';

type DashboardOrderView = 'pending' | 'unshipped' | 'shipped';

const getOrderViewFromSearch = (search: string): DashboardOrderView => {
    const params = new URLSearchParams(search);
    if (params.has('unshipped')) return 'unshipped';
    if (params.has('pending')) return 'pending';
    if (params.has('shipped')) return 'shipped';
    return 'pending';
};

function DashboardPageContent() {
    const searchParams = useSearchParams();
    const queryClient = useQueryClient();
    const [selectedShipped, setSelectedShipped] = useState<ShippedOrder | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const orderView = getOrderViewFromSearch(searchParams.toString());

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
        queryClient.prefetchQuery({
            queryKey: ['dashboard-table', 'pending', { searchQuery: '', packedBy: undefined, testedBy: undefined }],
            queryFn: () => fetchPendingOrdersData({}),
            staleTime: 60000,
        });
        queryClient.prefetchQuery({
            queryKey: ['dashboard-table', 'unshipped', { searchQuery: '', packedBy: undefined, testedBy: undefined }],
            queryFn: () => fetchUnshippedOrdersData({}),
            staleTime: 60000,
        });
        queryClient.prefetchQuery({
            queryKey: ['dashboard-table', 'shipped', { search: '', packedBy: undefined, testedBy: undefined }],
            queryFn: () => fetchDashboardShippedData({}),
            staleTime: 60000,
        });
    }, [queryClient]);

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
