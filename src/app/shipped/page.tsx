'use client';

import React from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import Navigation from '@/components/Navigation';

const queryClient = new QueryClient();

function ShippedDashboard() {
    const { data: shippedItems = [], isLoading } = useQuery({
        queryKey: ['shipped'],
        queryFn: () => fetch('/api/shipped').then(r => r.json())
    });

    const safeShippedItems = Array.isArray(shippedItems) ? shippedItems : [];

    if (isLoading) return <div className="p-4 text-sm">Loading shipped items...</div>;

    return (
        <div className="min-h-screen bg-white text-black font-sans">
            <Navigation />

            <div className="p-2">
                <div className="overflow-x-auto border border-gray-300">
                    <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-[#0a192f] text-white">
                            <tr>
                                <th className="p-2 border-r border-gray-600 font-semibold">Order ID</th>
                                <th className="p-2 border-r border-gray-600 font-semibold">Buyer Name</th>
                                <th className="p-2 border-r border-gray-600 font-semibold">Product Title</th>
                                <th className="p-2 border-r border-gray-600 font-semibold">SKU</th>
                                <th className="p-2 border-r border-gray-600 font-semibold">Shipped Date</th>
                                <th className="p-2 border-r border-gray-600 font-semibold">Carrier</th>
                                <th className="p-2 font-semibold">Tracking #</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {safeShippedItems.length === 0 ? (
                                <tr><td colSpan={7} className="p-4 text-center text-gray-500">No shipped items found.</td></tr>
                            ) : (
                                safeShippedItems.map((item: any, i: number) => (
                                    <tr
                                        key={item.id || i}
                                        className="hover:bg-blue-50 transition-colors even:bg-gray-50"
                                    >
                                        <td className="p-2 border-r border-gray-200 font-medium whitespace-nowrap">{item.order_id}</td>
                                        <td className="p-2 border-r border-gray-200 whitespace-nowrap">{item.buyer_name}</td>
                                        <td className="p-2 border-r border-gray-200 truncate max-w-[200px]" title={item.product_title}>
                                            {item.product_title}
                                        </td>
                                        <td className="p-2 border-r border-gray-200 whitespace-nowrap">{item.sku}</td>
                                        <td className="p-2 border-r border-gray-200 whitespace-nowrap">
                                            {item.shipped_date ? new Date(item.shipped_date).toLocaleDateString() : '-'}
                                        </td>
                                        <td className="p-2 border-r border-gray-200 whitespace-nowrap">{item.carrier}</td>
                                        <td className="p-2 font-mono text-[10px] whitespace-nowrap">{item.tracking_number}</td>
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

export default function ShippedPage() {
    return (
        <QueryClientProvider client={queryClient}>
            <ShippedDashboard />
        </QueryClientProvider>
    );
}
