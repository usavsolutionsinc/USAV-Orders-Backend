'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '@/components/DataTable';
import DailyChecklist from '@/components/DailyChecklist';

export default function TechnicianPage() {
    const params = useParams();
    const techId = params.id;
    const [scanInput, setScanInput] = useState('');
    const [lastAction, setLastAction] = useState<string | null>(null);
    const [dailyCount, setDailyCount] = useState(0); // New state

    // Fetch all orders for now, filtering logic can be added later or on backend
    const { data: orders = [], isLoading, refetch } = useQuery({
        queryKey: ['orders'],
        queryFn: () => fetch('/api/orders').then(r => r.json())
    });

    const handleScan = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!scanInput.trim()) return;

        try {
            const res = await fetch('/api/scan/technician', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: scanInput, techId })
            });
            const data = await res.json();

            if (data.success) {
                setLastAction(data.message);
                if (data.dailyCount !== undefined) {
                    setDailyCount(data.dailyCount);
                }
                if (data.serials) {
                    alert(`Serial Numbers for this SKU: ${data.serials}`);
                }
                refetch(); // Refresh data if status changed
            } else {
                alert(data.message);
            }
            setScanInput('');
        } catch (err) {
            console.error(err);
            alert('Scan failed');
        }
    };

    const safeOrders = Array.isArray(orders) ? orders : [];

    // Columns optimized for Technician view (Sheet style)
    const columns = [
        { header: 'Order ID', accessor: 'id' as const, className: 'font-bold' },
        { header: 'Product', accessor: (order: any) => order.items?.map((it: any) => it.title).join(', ') || order.product_title, className: 'truncate max-w-[300px]' },
        { header: 'SKU', accessor: (order: any) => order.items?.map((it: any) => it.sku).join(', ') || order.sku },
        { header: 'Date / Time', accessor: (order: any) => new Date().toLocaleString() }, // Placeholder for scan time
        { header: 'Title', accessor: 'product_title' as const },
        { header: 'Shipping TRK #', accessor: 'tracking_number' as const, className: 'font-mono' },
        { header: 'Serial Number Data', accessor: 'serial_numbers' as const },
        { header: 'Input', accessor: 'last_input' as const }, // Placeholder for last input
        { header: 'As', accessor: 'asin' as const },
        { header: 'SKU', accessor: 'sku' as const },
        { header: '#', accessor: 'qty' as const },
    ];

    if (isLoading) return <div className="p-4 text-sm">Loading technician data...</div>;

    return (
        <div className="min-h-screen bg-white text-black font-sans pb-20">
            <div className="p-2">
                <div className="mb-4 flex items-center justify-between bg-gray-100 p-3 rounded border border-gray-300">
                    <div className="flex items-center gap-4">
                        <h1 className="text-xl font-bold text-[#0a192f]">Technician {techId} Dashboard</h1>
                        <div className="bg-blue-100 text-blue-800 px-3 py-1 rounded font-bold">
                            Today: {dailyCount}
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {lastAction && <span className="text-green-600 font-bold">{lastAction}</span>}
                    </div>
                </div>

                {/* Daily Checklist */}
                <div className="mb-4">
                    <DailyChecklist userId={techId as string} role="technician" />
                </div>

                <DataTable
                    data={orders}
                    columns={columns}
                    keyField="id"
                    emptyMessage="Scan a tracking number to load order."
                    variant="sheet"
                />

                {/* Bottom Right Scan Form */}
                <div className="fixed bottom-4 right-4 bg-white p-4 rounded-lg shadow-xl border border-gray-300 z-50">
                    <form onSubmit={handleScan} className="flex gap-2 items-center">
                        <label className="font-bold text-sm">Scan:</label>
                        <input
                            type="text"
                            value={scanInput}
                            onChange={(e) => setScanInput(e.target.value)}
                            placeholder="Tracking / SKU / Status..."
                            className="px-3 py-2 border border-gray-400 rounded text-sm w-64 focus:outline-none focus:border-blue-600"
                            autoFocus
                        />
                        <button type="submit" className="bg-[#0a192f] text-white px-4 py-2 rounded text-sm font-bold hover:bg-blue-900">
                            Enter
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
