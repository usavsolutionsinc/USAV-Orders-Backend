'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import qz from 'qz-tray';
import sha256 from 'js-sha256';

// ==== QZ TRAY SECURITY ====
// In a real app, these would be loaded from env vars
// qz.security.setCertificatePromise(() => Promise.resolve("YOUR CERT HERE"));
// qz.security.setSignaturePromise((toSign) => Promise.resolve(sha256(toSign + "YOUR PRIVATE KEY")));

const queryClient = new QueryClient();

// ==== PRINT FUNCTION (silent, no dialogs) ====
async function printEverything(order: any) {
    try {
        if (!qz.websocket.isActive()) {
            await qz.websocket.connect().catch((e: any) => console.error("QZ Connection Error:", e));
        }

        // Collect all manual PDFs from every SKU in the order
        const manualUrls = order.items.flatMap((item: any) =>
            item.skuDocuments.map((doc: any) => doc.url)
        );

        // 1. Normal printer → Packing slip + all manuals (as PDFs)
        // Note: In a real scenario, you'd fetch the printer name from config
        const configDocs = qz.configs.create("Brother Laser");
        await qz.print(configDocs, [
            { type: 'pdf', data: `/api/packing-slip?orderId=${order.id}` },
            ...manualUrls.map((url: string) => ({ type: 'pdf', data: url }))
        ]).catch((e: any) => console.error("Printing Docs Error:", e));

        // 2. Thermal label printer → Shipping label
        const configLabel = qz.configs.create("Zebra GX430t");
        await qz.print(configLabel, [
            { type: 'raw', format: 'zpl', data: order.shippingLabelZpl }
        ]).catch((e: any) => console.error("Printing Label Error:", e));

        // Mark as printed
        await fetch(`/api/orders/${order.id}/printed`, { method: 'POST' });
        alert(`Printed Order ${order.id}`); // Temporary feedback
    } catch (err) {
        console.error("Print failed", err);
        alert("Printing failed. Check console for details. Make sure QZ Tray is running.");
    }
}

function Dashboard() {
    const { data: orders = [] } = useQuery({
        queryKey: ['orders'],
        queryFn: () => fetch('/api/orders').then(r => r.json())
    });

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-cyan-50 p-6">
            <motion.h1
                initial={{ y: -50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="text-4xl font-bold text-center mb-10 text-gray-800"
            >
                Antigravity Warehouse — Ready to Ship
            </motion.h1>

            <div className="max-w-7xl mx-auto overflow-hidden rounded-2xl shadow-2xl bg-white/80 backdrop-blur">
                <table className="w-full text-left">
                    <thead className="bg-gradient-to-r from-purple-600 to-cyan-600 text-white">
                        <tr>
                            <th className="p-4">Order ID</th>
                            <th className="p-4">Buyer Name</th>
                            <th className="p-4">Product Title</th>
                            <th className="p-4 text-center">QTY</th>
                            <th className="p-4">Ship by date</th>
                            <th className="p-4">SKU</th>
                            <th className="p-4">As</th>
                            <th className="p-4">Shipping TRK #</th>
                            <th className="p-4 text-center">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orders.map((order: any, i: number) => (
                            <motion.tr
                                key={order.id}
                                initial={{ opacity: 0, x: -50 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.05 }}
                                className="border-b hover:bg-purple-50/50 transition"
                            >
                                <td className="p-4 font-medium">{order.id}</td>
                                <td className="p-4">{order.buyerName}</td>
                                <td className="p-4">{order.items.map((it: any) => it.title).join(', ')}</td>
                                <td className="p-4 text-center">{order.items.reduce((a: number, it: any) => a + it.qty, 0)}</td>
                                <td className="p-4">{new Date(order.shipBy).toLocaleDateString()}</td>
                                <td className="p-4">{order.items.map((it: any) => it.sku).join(', ')}</td>
                                <td className="p-4">{order.shippingSpeed}</td>
                                <td className="p-4 font-mono text-sm">{order.trackingNumber}</td>
                                <td className="p-4 text-center">
                                    <motion.button
                                        whileHover={{ scale: 1.1 }}
                                        whileTap={{ scale: 0.95 }}
                                        onClick={() => printEverything(order)}
                                        className="px-6 py-3 bg-gradient-to-r from-purple-600 to-cyan-600 text-white rounded-full shadow-lg font-medium"
                                    >
                                        Print Docs + Label
                                    </motion.button>
                                </td>
                            </motion.tr>
                        ))}
                    </tbody>
                </table>
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
