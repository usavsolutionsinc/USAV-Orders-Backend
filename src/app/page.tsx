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

    const columns = [
        { header: 'Order ID', accessor: 'id' as const, className: 'font-medium' },
        {
            header: 'Product Title',
            accessor: (order: any) => (
                <span title={order.items.map((it: any) => it.title).join(', ')} className="truncate block max-w-[200px]">
                    {order.items.map((it: any) => it.title).join(', ')}
                </span>
            )
        },
        {
            header: '#',
            accessor: (order: any) => order.items.reduce((a: number, it: any) => a + (it.qty || 0), 0),
            className: 'text-center'
        },
        {
            header: 'Ship by',
            accessor: (order: any) => order.shipBy ? new Date(order.shipBy).toLocaleDateString() : '-'
        },
        {
            header: 'SKU',
            accessor: (order: any) => order.items.map((it: any) => it.sku).join(', ')
        },
        { header: 'Item #', accessor: 'item_index' as const }, // Placeholder or need to map
        { header: 'As', accessor: 'asin' as const }, // Assuming 'As' means ASIN or Assigned
        { header: 'Shipping TRK #', accessor: 'trackingNumber' as const, className: 'font-mono text-[10px]' },
        { header: 'OOS - We Need', accessor: 'oos_needed' as const }, // Placeholder
        { header: 'Notes', accessor: 'notes' as const },
        { header: 'Receiving TRK #', accessor: 'receiving_tracking' as const }, // Placeholder
        {
            header: 'Action',
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
        <div className="min-h-screen bg-white text-black font-sans">
            <div className="p-2">
                <DataTable
                    data={safeOrders}
                    columns={columns}
                    keyField="id"
                    emptyMessage="No orders found."
                />
            </div>
        </div>
    );
}

