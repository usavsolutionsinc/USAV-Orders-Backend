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
        <div className="min-h-screen bg-white text-black font-sans flex flex-col">
            {/* Checklist Section - Fixed at top after nav */}
            <div className="flex-shrink-0 p-4 border-b border-gray-200">
                <div className="bg-gray-100 p-4 rounded border border-gray-300">
                    <h2 className="text-lg font-bold text-[#0a192f] mb-2">Shipped Checklist</h2>
                    <p className="text-sm text-gray-600">Manage your shipped items workflow</p>
                </div>
            </div>

            {/* Sheet Section - Full height at bottom */}
            <div className="flex-1 flex flex-col min-h-0">
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
