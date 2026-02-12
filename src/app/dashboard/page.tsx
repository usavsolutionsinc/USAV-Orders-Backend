'use client';

import { Suspense, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import DashboardSidebar from '@/components/DashboardSidebar';
import { DashboardShippedTable, ShippedDetailsPanel } from '@/components/shipped';
import { Loader2 } from '@/components/Icons';
import { ShippedOrder } from '@/lib/neon/orders-queries';

export default function DashboardPage() {
    const [selectedShipped, setSelectedShipped] = useState<ShippedOrder | null>(null);

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

    return (
        <div className="flex h-full w-full">
            <DashboardSidebar />
            <Suspense fallback={
                <div className="flex-1 flex items-center justify-center bg-gray-50">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                </div>
            }>
                <DashboardShippedTable />
            </Suspense>

            <AnimatePresence>
                {selectedShipped && (
                    <ShippedDetailsPanel
                        shipped={selectedShipped}
                        onClose={() => {
                            window.dispatchEvent(new CustomEvent('close-shipped-details'));
                            setSelectedShipped(null);
                        }}
                        onUpdate={() => {
                            window.dispatchEvent(new CustomEvent('dashboard-refresh'));
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
