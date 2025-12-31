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

    // Generate columns dynamically from col_1 to col_10
    const columns = Array.from({ length: 10 }, (_, i) => ({
        header: `col_${i + 1}`,
        accessor: `col_${i + 1}` as const,
        colKey: `col_${i + 1}`,
        className: i === 4 ? 'font-mono' : '' // col_5 is typically tracking number
    }));

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
                    tableName="shipped"
                    showColumnManager={true}
                />
            </div>
        </div>
    );
}
