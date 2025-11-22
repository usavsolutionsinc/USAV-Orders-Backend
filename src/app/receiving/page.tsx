'use client';

import React from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import Navigation from '@/components/Navigation';

const queryClient = new QueryClient();

function ReceivingDashboard() {
    const { data: receivingItems = [], isLoading } = useQuery({
        queryKey: ['receiving'],
        queryFn: () => fetch('/api/receiving').then(r => r.json())
    });

    const safeReceivingItems = Array.isArray(receivingItems) ? receivingItems : [];

    if (isLoading) return <div className="p-4 text-sm">Loading receiving items...</div>;

    return (
        <div className="min-h-screen bg-white text-black font-sans">
            <Navigation />

            <div className="p-2">
                <div className="overflow-x-auto border border-gray-300">
                    <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-[#0a192f] text-white">
                            <tr>
                                <th className="p-2 border-r border-gray-600 font-semibold">ID</th>
                                <th className="p-2 border-r border-gray-600 font-semibold">Item Name</th>
                                <th className="p-2 border-r border-gray-600 font-semibold">Supplier</th>
                                <th className="p-2 border-r border-gray-600 text-center font-semibold">Expected</th>
                                <th className="p-2 border-r border-gray-600 text-center font-semibold">Received</th>
                                <th className="p-2 border-r border-gray-600 font-semibold">Arrival Date</th>
                                <th className="p-2 font-semibold">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {safeReceivingItems.length === 0 ? (
                                <tr><td colSpan={7} className="p-4 text-center text-gray-500">No receiving items found.</td></tr>
                            ) : (
                                safeReceivingItems.map((item: any, i: number) => (
                                    <tr
                                        key={item.id || i}
                                        className="hover:bg-blue-50 transition-colors even:bg-gray-50"
                                    >
                                        <td className="p-2 border-r border-gray-200 font-medium whitespace-nowrap">{item.id}</td>
                                        <td className="p-2 border-r border-gray-200 truncate max-w-[200px]" title={item.item_name}>
                                            {item.item_name}
                                        </td>
                                        <td className="p-2 border-r border-gray-200 whitespace-nowrap">{item.supplier}</td>
                                        <td className="p-2 border-r border-gray-200 text-center">{item.expected_qty}</td>
                                        <td className="p-2 border-r border-gray-200 text-center">{item.received_qty}</td>
                                        <td className="p-2 border-r border-gray-200 whitespace-nowrap">
                                            {item.arrival_date ? new Date(item.arrival_date).toLocaleDateString() : '-'}
                                        </td>
                                        <td className="p-2 whitespace-nowrap">
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${item.status === 'Completed' ? 'bg-green-100 text-green-800' :
                                                item.status === 'Pending' ? 'bg-yellow-100 text-yellow-800' :
                                                    'bg-gray-100 text-gray-800'
                                                }`}>
                                                {item.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
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
