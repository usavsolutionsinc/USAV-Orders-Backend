'use client';

import { Suspense, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import DashboardSidebar from '@/components/DashboardSidebar';
import ShippedSidebar from '@/components/ShippedSidebar';
import { ShippedDetailsPanel, ShippedTable, type ShippedFormData } from '@/components/shipped';
import { ShippedTableBase } from '@/components/shipped/ShippedTableBase';
import UnshippedSidebar from '@/components/unshipped/UnshippedSidebar';
import { UnshippedDetailsPanel } from '@/components/unshipped/UnshippedDetailsPanel';
import { Loader2 } from '@/components/Icons';
import { ShippedOrder } from '@/lib/neon/orders-queries';
import { dmSans } from '@/lib/fonts';

type DashboardOrderView = 'pending' | 'unshipped' | 'shipped';

const ORDER_VIEW_OPTIONS: Array<{ value: DashboardOrderView; label: string }> = [
    { value: 'unshipped', label: 'Unshipped Orders' },
    { value: 'pending', label: 'Pending Orders' },
    { value: 'shipped', label: 'Shipped Orders' },
];

const getOrderViewFromSearch = (search: string): DashboardOrderView => {
    const params = new URLSearchParams(search);
    if (params.has('unshipped')) return 'unshipped';
    if (params.has('pending')) return 'pending';
    if (params.has('shipped')) return 'shipped';
    return 'pending';
};

const normalizeOrderViewParams = (params: URLSearchParams, preferredView?: DashboardOrderView): DashboardOrderView => {
    const nextView = preferredView ?? getOrderViewFromSearch(params.toString());
    params.delete('unshipped');
    params.delete('pending');
    params.delete('shipped');
    params.set(nextView, '');
    return nextView;
};

export default function DashboardPage() {
    const [selectedShipped, setSelectedShipped] = useState<ShippedOrder | null>(null);
    const [showIntakeForm, setShowIntakeForm] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [orderView, setOrderView] = useState<DashboardOrderView>('pending');
    const [isOrderViewOpen, setIsOrderViewOpen] = useState(false);

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
        const params = new URLSearchParams(window.location.search);
        const isNew = params.get('new') === 'true';
        if (isNew) {
            setShowIntakeForm(true);
            params.delete('new');
            if (!params.has('shipped') && !params.has('pending') && !params.has('unshipped')) {
                params.set('pending', '');
            }
            window.history.replaceState({}, '', `/dashboard?${params.toString()}`);
        }
    }, []);

    useEffect(() => {
        const handleOpenIntake = () => setShowIntakeForm(true);
        window.addEventListener('dashboard-open-intake', handleOpenIntake as any);
        return () => {
            window.removeEventListener('dashboard-open-intake', handleOpenIntake as any);
        };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const syncFromUrl = () => {
            const params = new URLSearchParams(window.location.search);
            const nextView = normalizeOrderViewParams(params);
            window.history.replaceState({}, '', `/dashboard?${params.toString()}`);
            setOrderView(nextView);
        };

        const params = new URLSearchParams(window.location.search);
        normalizeOrderViewParams(params);
        window.history.replaceState({}, '', `/dashboard?${params.toString()}`);

        syncFromUrl();
        window.addEventListener('popstate', syncFromUrl);
        return () => {
            window.removeEventListener('popstate', syncFromUrl);
        };
    }, []);

    const handleCloseForm = () => {
        setShowIntakeForm(false);
    };

    const handleOrderViewChange = (nextView: DashboardOrderView) => {
        const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
        normalizeOrderViewParams(params, nextView);
        if (nextView !== 'shipped') {
            params.delete('search');
        }
        if (typeof window !== 'undefined') {
            window.history.replaceState({}, '', `/dashboard?${params.toString()}`);
        }
        setOrderView(nextView);
        setIsOrderViewOpen(false);
        setSelectedShipped(null);
        window.dispatchEvent(new CustomEvent('close-shipped-details'));
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

    const filterControl = (
        <section className="relative w-full">
            <button
                type="button"
                onClick={() => setIsOrderViewOpen((prev) => !prev)}
                className={`flex h-14 w-full items-center justify-between border-b border-gray-200 bg-white px-4 text-left text-[13px] uppercase tracking-wide text-gray-900 hover:bg-gray-50 transition-colors ${dmSans.className} font-bold`}
            >
                <span>{ORDER_VIEW_OPTIONS.find((option) => option.value === orderView)?.label}</span>
                <svg
                    className={`h-4 w-4 text-gray-500 transition-transform ${isOrderViewOpen ? 'rotate-180' : ''}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                </svg>
            </button>
            {isOrderViewOpen ? (
                <div className="absolute left-0 right-0 top-full z-50 border-b border-gray-200 bg-white shadow-xl">
                    {ORDER_VIEW_OPTIONS.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => handleOrderViewChange(option.value)}
                            className={`w-full border-t border-gray-100 px-4 py-4 text-left text-[13px] uppercase tracking-wide transition-colors ${dmSans.className} ${
                                orderView === option.value
                                    ? 'bg-blue-600 text-white font-bold'
                                    : 'bg-white text-gray-700 font-semibold hover:bg-blue-50 hover:text-blue-700'
                            }`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            ) : null}
        </section>
    );

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
                    {orderView === 'shipped' ? (
                        <ShippedSidebar
                            showIntakeForm={showIntakeForm}
                            onCloseForm={handleCloseForm}
                            onFormSubmit={handleSubmitForm}
                            filterControl={filterControl}
                            showDetailsPanel={false}
                        />
                    ) : orderView === 'unshipped' ? (
                        <UnshippedSidebar
                            showIntakeForm={showIntakeForm}
                            onCloseForm={handleCloseForm}
                            onFormSubmit={handleSubmitForm}
                            filterControl={filterControl}
                        />
                    ) : (
                        <DashboardSidebar
                            showIntakeForm={showIntakeForm}
                            onCloseForm={handleCloseForm}
                            onFormSubmit={handleSubmitForm}
                            filterControl={filterControl}
                        />
                    )}
                </motion.div>
            </motion.div>
            <Suspense fallback={
                <div className="flex-1 flex items-center justify-center bg-gray-50">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                </div>
            }>
                {orderView === 'shipped' ? (
                    <ShippedTable key={`shipped-${refreshKey}`} showWeekNavigation={false} />
                ) : orderView === 'unshipped' ? (
                    <ShippedTableBase key={`unshipped-${refreshKey}`} ordersOnly missingTrackingOnly showWeekNavigation={false} />
                ) : (
                    <ShippedTableBase key={`pending-${refreshKey}`} ordersOnly showWeekNavigation={false} />
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
