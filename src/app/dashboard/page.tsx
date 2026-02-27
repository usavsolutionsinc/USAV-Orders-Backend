'use client';

import { Suspense, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import DashboardSidebar from '@/components/DashboardSidebar';
import { DashboardShippedTable, ShippedDetailsPanel, type ShippedFormData } from '@/components/shipped';
import { Loader2 } from '@/components/Icons';
import { ShippedOrder } from '@/lib/neon/orders-queries';

export default function DashboardPage() {
    const [selectedShipped, setSelectedShipped] = useState<ShippedOrder | null>(null);
    const [showIntakeForm, setShowIntakeForm] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

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
        if (typeof window === 'undefined') return;
        const isNew = new URLSearchParams(window.location.search).get('new') === 'true';
        if (isNew) {
            setShowIntakeForm(true);
            window.history.replaceState({}, '', '/dashboard');
        }
    }, []);

    useEffect(() => {
        const handleOpenIntake = () => setShowIntakeForm(true);
        window.addEventListener('dashboard-open-intake', handleOpenIntake as any);
        return () => {
            window.removeEventListener('dashboard-open-intake', handleOpenIntake as any);
        };
    }, []);

    const handleCloseForm = () => {
        setShowIntakeForm(false);
    };

    const handleSubmitForm = async (data: ShippedFormData) => {
        try {
            const response = data.mode === 'add_order'
                ? await fetch('/api/orders/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        orderId: data.order_id,
                        productTitle: data.product_title,
                        shippingTrackingNumber: data.shipping_tracking_number,
                        sku: data.sku || null,
                        accountSource: 'Manual',
                        condition: data.condition,
                    })
                })
                : await fetch('/api/shipped/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

            const result = await response.json();
            if (!result.success) {
                alert(result.error || 'Failed to submit form. Please try again.');
                return;
            }

            setShowIntakeForm(false);
            setRefreshKey((prev) => prev + 1);
            window.dispatchEvent(new CustomEvent('dashboard-refresh'));
            window.dispatchEvent(new CustomEvent('usav-refresh-data'));
        } catch (error) {
            console.error('Error submitting dashboard intake form:', error);
            alert('Error submitting form. Please try again.');
        }
    };

    return (
        <div className="flex h-full w-full">
            <motion.div
                initial={false}
                animate={{
                    width: selectedShipped ? 0 : 300,
                    marginRight: selectedShipped ? 0 : 0,
                }}
                transition={{
                    type: 'spring',
                    damping: 25,
                    stiffness: 350,
                    mass: 0.5
                }}
                className="overflow-hidden flex-shrink-0 z-40 h-full"
            >
                <motion.div
                    animate={{
                        x: selectedShipped ? -300 : 0,
                        opacity: selectedShipped ? 0 : 1,
                        scale: selectedShipped ? 0.95 : 1,
                    }}
                    transition={{
                        type: 'spring',
                        damping: 25,
                        stiffness: 350,
                        mass: 0.5
                    }}
                    className="h-full w-[300px]"
                >
                    <DashboardSidebar
                        showIntakeForm={showIntakeForm}
                        onCloseForm={handleCloseForm}
                        onFormSubmit={handleSubmitForm}
                    />
                </motion.div>
            </motion.div>
            <Suspense fallback={
                <div className="flex-1 flex items-center justify-center bg-gray-50">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                </div>
            }>
                <DashboardShippedTable key={refreshKey} />
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
