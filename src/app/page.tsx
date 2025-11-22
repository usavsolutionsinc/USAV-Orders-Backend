'use client';

import React from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import qz from 'qz-tray';
import Navigation from '@/components/Navigation';

const queryClient = new QueryClient();

// ==== PRINT FUNCTION (silent, no dialogs) ====
async function printEverything(order: any) {
    try {
        if (!qz.websocket.isActive()) {
            await qz.websocket.connect().catch((e: any) => console.error("QZ Connection Error:", e));
        }

        // Collect all manual PDFs from every SKU in the order
        const manualUrls = order.items.flatMap((item: any) =>
            item.skuDocuments ? item.skuDocuments.map((doc: any) => doc.url) : []
        );

        // 1. Normal printer → Packing slip + all manuals (as PDFs)
        const configDocs = qz.configs.create("Brother Laser");
        await qz.print(configDocs, [
            { type: 'pdf', data: `/api/packing-slip?orderId=${order.id}` },
            ...manualUrls.map((url: string) => ({ type: 'pdf', data: url }))
        ]).catch((e: any) => console.error("Printing Docs Error:", e));

        // 2. Thermal label printer → Shipping label
        if (order.shippingLabelZpl) {
            const configLabel = qz.configs.create("Zebra GX430t");
            await qz.print(configLabel, [
                { type: 'raw', format: 'zpl', data: order.shippingLabelZpl }
            ]).catch((e: any) => console.error("Printing Label Error:", e));
        }

        // Mark as printed
        await fetch(`/api/orders/${order.id}/printed`, { method: 'POST' });
        alert(`Printed Order ${order.id}`);
    } catch (err) {
        console.error("Print failed", err);
        alert("Printing failed. Check console for details.");
    }
}

function Dashboard() {
    const { data: orders = [], isLoading } = useQuery({
        queryKey: ['orders'],
        queryFn: () => fetch('/api/orders').then(r => r.json())
    });

    const safeOrders = Array.isArray(orders) ? orders : [];

    if (isLoading) return <div className="p-4 text-sm">Loading orders...</div>;

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
                                <th className="p-2 border-r border-gray-600 text-center font-semibold">QTY</th>
                                <th className="p-2 border-r border-gray-600 font-semibold">Ship By</th>
                                <th className="p-2 border-r border-gray-600 font-semibold">SKU</th>
                                <th className="p-2 border-r border-gray-600 font-semibold">Speed</th>
                                <th className="p-2 border-r border-gray-600 font-semibold">Tracking #</th>
                                <th className="p-2 text-center font-semibold">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {safeOrders.map((order: any, i: number) => (
                                <tr
                                    key={order.id || i}
                                    className="hover:bg-blue-50 transition-colors even:bg-gray-50"
                                >
                                    <td className="p-2 border-r border-gray-200 font-medium whitespace-nowrap">{order.id}</td>
                                    <td className="p-2 border-r border-gray-200 whitespace-nowrap">{order.buyerName}</td>
                                    <td className="p-2 border-r border-gray-200 truncate max-w-[200px]" title={order.items.map((it: any) => it.title).join(', ')}>
                                        {order.items.map((it: any) => it.title).join(', ')}
                                    </td>
                                    <td className="p-2 border-r border-gray-200 text-center">
                                        {order.items.reduce((a: number, it: any) => a + (it.qty || 0), 0)}
                                    </td>
                                    <td className="p-2 border-r border-gray-200 whitespace-nowrap">
                                        {order.shipBy ? new Date(order.shipBy).toLocaleDateString() : '-'}
                                    </td>
                                    <td className="p-2 border-r border-gray-200 whitespace-nowrap">
                                        {order.items.map((it: any) => it.sku).join(', ')}
                                    </td>
                                    <td className="p-2 border-r border-gray-200 whitespace-nowrap">{order.shippingSpeed}</td>
                                    <td className="p-2 border-r border-gray-200 font-mono text-[10px] whitespace-nowrap">
                                        {order.trackingNumber}
                                    </td>
                                    <td className="p-1 text-center">
                                        <button
                                            onClick={() => printEverything(order)}
                                            className="px-2 py-1 bg-[#0a192f] text-white rounded hover:bg-blue-900 text-[10px] uppercase font-bold tracking-wider"
                                        >
                                            Print
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
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

