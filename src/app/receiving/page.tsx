'use client';

import React from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import Navigation from '@/components/Navigation';
import { DataTable } from '@/components/DataTable';

const queryClient = new QueryClient();

function ReceivingDashboard() {
    const { data: receivingItems = [], isLoading } = useQuery({
        queryKey: ['receiving'],
        queryFn: () => fetch('/api/receiving').then(r => r.json())
    });

    const safeReceivingItems = Array.isArray(receivingItems) ? receivingItems : [];

    const columns = [
        { header: 'ID', accessor: 'id' as const, className: 'font-medium' },
        {
            header: 'Item Name',
            accessor: (item: any) => (
                <span title={item.item_name} className="truncate block max-w-[200px]">
                    {item.item_name}
                </span>
            )
        },
        { header: 'Supplier', accessor: 'supplier' as const },
        { header: 'Expected', accessor: 'expected_qty' as const, className: 'text-center', headerClassName: 'text-center' },
        { header: 'Received', accessor: 'received_qty' as const, className: 'text-center', headerClassName: 'text-center' },
        {
            header: 'Arrival Date',
            accessor: (item: any) => item.arrival_date ? new Date(item.arrival_date).toLocaleDateString() : '-'
        },
        {
            header: 'Status',
            accessor: (item: any) => (
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${item.status === 'Completed' ? 'bg-green-100 text-green-800' :
                        item.status === 'Pending' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-gray-100 text-gray-800'
                    }`}>
                    {item.status}
                </span>
            )
        }
    ];

    if (isLoading) return <div className="p-4 text-sm">Loading receiving items...</div>;

    return (
        <div className="min-h-screen bg-white text-black font-sans">
            <Navigation />
            <div className="p-2">
                <DataTable
                    data={safeReceivingItems}
                    columns={columns}
                    keyField="id"
                    emptyMessage="No receiving items found."
                />
            </div>
        </div>
    );
}

export default function ReceivingPage() {
    return (
        <QueryClientProvider client={queryClient}>
            <ReceivingDashboard />
        </QueryClientProvider>
    );
}
