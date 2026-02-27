'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import ShippedSidebar from '@/components/ShippedSidebar';
import { ShippedTable, type ShippedFormData } from '@/components/shipped';
import { Loader2 } from '@/components/Icons';

function ShippedPageContent() {
    const [showIntakeForm, setShowIntakeForm] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const searchParams = useSearchParams();
    const isNew = searchParams.get('new') === 'true';

    useEffect(() => {
        if (isNew) {
            setShowIntakeForm(true);
            // Clear the param after opening
            window.history.replaceState({}, '', '/shipped');
        }
    }, [isNew]);

    const handleCloseForm = () => {
        setShowIntakeForm(false);
    };

    const handleSubmitForm = async (data: ShippedFormData) => {
        setIsSubmitting(true);
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

            if (result.success) {
                if (data.mode === 'add_order') {
                    alert(`✓ Order added successfully!\n\nOrder ID: ${data.order_id}\nTracking: ${data.shipping_tracking_number}`);
                } else {
                    alert(`✓ Shipped entry created successfully!\n\nOrder ID: ${data.order_id}\nTracking: ${data.shipping_tracking_number}`);
                }
                setShowIntakeForm(false);
                // Trigger table refresh
                setRefreshKey(prev => prev + 1);
            } else {
                alert(result.error || 'Failed to submit form. Please try again.');
            }
        } catch (error) {
            console.error('Error submitting shipped form:', error);
            alert('Error submitting form. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex h-full w-full">
            {/* ShippedSidebar with form support */}
            <ShippedSidebar 
                showIntakeForm={showIntakeForm}
                onCloseForm={handleCloseForm}
                onFormSubmit={handleSubmitForm}
            />
            
            {/* ShippedTable component reading from Neon DB */}
            <Suspense fallback={
                <div className="flex-1 flex items-center justify-center bg-gray-50">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                </div>
            }>
                <ShippedTable key={refreshKey} />
            </Suspense>
        </div>
    );
}

export default function ShippedPage() {
    return (
        <Suspense fallback={
            <div className="flex h-full w-full items-center justify-center bg-gray-50">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
        }>
            <ShippedPageContent />
        </Suspense>
    );
}
