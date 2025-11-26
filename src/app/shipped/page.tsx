'use client';

import React from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import Navigation from '@/components/Navigation';
import { DataTable } from '@/components/DataTable';

const queryClient = new QueryClient();

function ShippedDashboard() {
    const { data: shippedItems = [], isLoading } = useQuery({
        queryKey: ['shipped'],
        queryFn: () => fetch('/api/shipped').then(r => r.json())
    });

    const safeShippedItems = Array.isArray(shippedItems) ? shippedItems : [];

    const columns = [
        { header: 'Order ID', accessor: 'order_id' as const, className: 'font-medium' },
        { header: 'Buyer Name', accessor: 'buyer_name' as const },
        {
            header: 'Product Title',
            accessor: (item: any) => (
                <span title={item.product_title} className="truncate block max-w-[200px]">
                    {item.product_title}
                </span>
            )
        },
        { header: 'SKU', accessor: 'sku' as const },
        {
            header: 'Shipped Date',
            accessor: (item: any) => item.shipped_date ? new Date(item.shipped_date).toLocaleDateString() : '-'
        },
        { header: 'Carrier', accessor: 'carrier' as const },
        { header: 'Tracking #', accessor: 'tracking_number' as const, className: 'font-mono text-[10px]' }
    ];

    if (isLoading) return <div className="p-4 text-sm">Loading shipped items...</div>;

    return (
        <div className="min-h-screen bg-white text-black font-sans">
            <Navigation />
            <div className="p-2">
                <DataTable
                    data={safeShippedItems}
                    columns={columns}
                    keyField="id"
                    emptyMessage="No shipped items found."
                />
            </div>
        </div>
    );
}

export default function ShippedPage() {
    return (
        <QueryClientProvider client={queryClient}>
            <ShippedDashboard />
        </QueryClientProvider>
    );
}
