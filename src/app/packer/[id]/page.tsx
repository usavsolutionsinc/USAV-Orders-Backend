'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '@/components/DataTable';
import { usePrinter } from '@/hooks/usePrinter';
import DailyChecklist from '@/components/DailyChecklist';

export default function PackerPage() {
    const params = useParams();
    const packerId = params.id;
    const [scanInput, setScanInput] = useState('');
    const [dailyCount, setDailyCount] = useState(0); // New state
    const { printOrder } = usePrinter();

    const { data: orders = [], isLoading } = useQuery({
        queryKey: ['orders'],
        queryFn: () => fetch('/api/orders').then(r => r.json())
    });

    const safeOrders = Array.isArray(orders) ? orders : [];

    const handleScan = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!scanInput.trim()) return;

        try {
            const res = await fetch('/api/scan/packer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: scanInput, packerId })
            });
            const data = await res.json();

            if (data.success) {
                // Could show a toast or update a log list
                console.log('Scan success:', data);
                if (data.dailyCount !== undefined) {
                    setDailyCount(data.dailyCount);
                }
                // If it was a tracking scan, maybe print?
                // if (data.type === 'TRACKING') ...
            } else {
                alert(data.message);
            }
            setScanInput('');
        } catch (err) {
            console.error(err);
            alert('Scan failed');
        }
    };

    const columns = [
        { header: 'Date / Time', accessor: (row: any) => new Date().toLocaleString() }, // Placeholder
        { header: 'Tracking Number/FNSKU', accessor: 'tracking_number' as const, className: 'font-mono' },
        { header: 'ID', accessor: 'id' as const },
        { header: 'Product Title', accessor: 'product_title' as const },
        { header: '#', accessor: 'qty' as const },
        {
            header: 'Action',
            accessor: (order: any) => <button onClick={() => printOrder(order)} className="text-blue-600 underline">Print</button>
        }
    ];

    if (isLoading) return <div className="p-4 text-sm">Loading packer data...</div>;

    return (
        <div className="min-h-screen bg-white text-black font-sans pb-20">
            <div className="p-2">
                <div className="mb-4 flex items-center justify-between bg-gray-100 p-3 rounded border border-gray-300">
                    <div className="flex items-center gap-4">
                        <h1 className="text-xl font-bold text-[#0a192f]">Packer {packerId} Dashboard</h1>
                        <div className="bg-blue-100 text-blue-800 px-3 py-1 rounded font-bold">
                            Today: {dailyCount}
                        </div>
                    </div>
                </div>

                {/* Daily Checklist */}
                <div className="mb-4">
                    <DailyChecklist userId={packerId as string} role="packer" />
                </div>

                <DataTable
                    data={safeOrders}
                    columns={columns}
                    keyField="id"
                    emptyMessage="No orders assigned."
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
                            placeholder="Scan Tracking / SKU..."
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
