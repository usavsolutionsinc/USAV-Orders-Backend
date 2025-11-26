'use client';

import React from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import Navigation from '@/components/Navigation';
import { DataTable } from '@/components/DataTable';
import { usePrinter } from '@/hooks/usePrinter';

const queryClient = new QueryClient();

function Dashboard() {
    const { data: orders = [], isLoading } = useQuery({
        queryKey: ['orders'],
        queryFn: () => fetch('/api/orders').then(r => r.json())
    });

    const { printOrder, isPrinting } = usePrinter();
    const safeOrders = Array.isArray(orders) ? orders : [];

    const columns = [
        { header: 'Order ID', accessor: 'id' as const, className: 'font-medium' },
        { header: 'Buyer Name', accessor: 'buyerName' as const },
        {
            header: 'Product Title',
            accessor: (order: any) => (
                <span title={order.items.map((it: any) => it.title).join(', ')} className="truncate block max-w-[200px]">
                    {order.items.map((it: any) => it.title).join(', ')}
                </span>
            )
        },
        {
            header: 'QTY',
            accessor: (order: any) => order.items.reduce((a: number, it: any) => a + (it.qty || 0), 0),
            className: 'text-center',
            headerClassName: 'text-center'
        },
        {
            header: 'Ship By',
            accessor: (order: any) => order.shipBy ? new Date(order.shipBy).toLocaleDateString() : '-'
        },
        {
            header: 'SKU',
            accessor: (order: any) => order.items.map((it: any) => it.sku).join(', ')
        },
        { header: 'Condition', accessor: 'shippingSpeed' as const }, // Mapped 'Speed' to 'Condition' per user request earlier, keeping key as shippingSpeed for now or should I check DB? The user changed header to Condition manually.
        { header: 'Tracking #', accessor: 'trackingNumber' as const, className: 'font-mono text-[10px]' },
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
            <Navigation />
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

export default function Home() {
    return (
        <QueryClientProvider client={queryClient}>
            <Dashboard />
        </QueryClientProvider>
    );
}

