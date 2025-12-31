'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '@/components/DataTable';
import { usePrinter } from '@/hooks/usePrinter';

export default function Home() {
    const { data: orders = [], isLoading } = useQuery({
        queryKey: ['orders'],
        queryFn: () => fetch('/api/orders').then(r => r.json())
    });

    const { printOrder, isPrinting } = usePrinter();
    const safeOrders = Array.isArray(orders) ? orders : [];

    // Generate columns dynamically from col_1 to col_16, plus print button
    const columns = [
        ...Array.from({ length: 16 }, (_, i) => ({
            header: `col_${i + 1}`,
            accessor: `col_${i + 1}` as const,
            colKey: `col_${i + 1}`,
            className: i === 10 ? 'font-mono text-[10px]' : '' // col_11 is typically tracking number
        })),
        {
            header: 'Print',
            accessor: (order: any) => (
                <button
                    onClick={() => printOrder(order)}
                    disabled={isPrinting}
                    className="px-2 py-1 bg-[#0a192f] text-white rounded hover:bg-blue-900 text-[10px] uppercase font-bold tracking-wider disabled:opacity-50"
                >
                    {isPrinting ? '...' : 'Print'}
                </button>
            ),
            className: 'text-center',
            headerClassName: 'text-center'
        }
    ];

    if (isLoading) return <div className="p-4 text-sm">Loading orders...</div>;

    return (
        <div className="min-h-screen bg-white text-black font-sans flex flex-col">
            {/* Checklist Section - Fixed at top after nav */}
            <div className="flex-shrink-0 p-2 border-b border-gray-200">
                <div className="bg-gray-100 p-3 rounded border border-gray-300">
                    <h2 className="text-lg font-bold text-[#0a192f] mb-2">Orders Checklist</h2>
                    <p className="text-sm text-gray-600">Manage your daily orders workflow</p>
                </div>
            </div>

            {/* Sheet Section - Full height at bottom */}
            <div className="flex-1 flex flex-col min-h-0">
                <DataTable
                    data={safeOrders}
                    columns={columns}
                    keyField="id"
                    emptyMessage="No orders found."
                    tableName="orders"
                    showColumnManager={true}
                />
            </div>
        </div>
    );
}
