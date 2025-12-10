'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '@/components/DataTable';

export default function ShippedPage() {
    const { data: shippedItems = [], isLoading } = useQuery({
        queryKey: ['shipped'],
        queryFn: () => fetch('/api/shipped').then(r => r.json())
    });

    const safeShippedItems = Array.isArray(shippedItems) ? shippedItems : [];

    const columns = [
        { header: 'Date-Time', accessor: (row: any) => new Date(row.shipped_date || row.timestamp).toLocaleString() },
        { header: 'Order ID', accessor: 'order_id' as const },
        { header: 'Product Title', accessor: 'product_title' as const },
        { header: 'As', accessor: 'asin' as const }, // Placeholder
        { header: 'Sent', accessor: 'sent_status' as const }, // Placeholder
        { header: 'Shipping TRK #', accessor: 'tracking_number' as const, className: 'font-mono' },
        { header: 'Serial Number', accessor: 'serial_numbers' as const },
        { header: 'Box', accessor: 'box_id' as const }, // Placeholder
        { header: 'By', accessor: 'tech_name' as const },
        { header: 'Size', accessor: 'size' as const }, // Placeholder
        { header: 'SKU', accessor: 'sku' as const },
    ];

    if (isLoading) return <div className="p-4 text-sm">Loading shipped items...</div>;

    return (
        <div className="min-h-screen bg-white text-black font-sans">
            <div className="p-2">
                <DataTable
                    data={safeShippedItems}
                    columns={columns}
                    keyField="id"
                    emptyMessage="No shipped items found."
                    variant="sheet"
                />
            </div>
        </div>
    );
}
