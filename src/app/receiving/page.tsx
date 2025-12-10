'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '@/components/DataTable';

export default function ReceivingPage() {
    const [scanInput, setScanInput] = useState('');
    const [lastScan, setLastScan] = useState<{ message: string; success: boolean; matchFound?: boolean } | null>(null);

    const { data: receiving = [], isLoading, refetch } = useQuery({
        queryKey: ['receiving'],
        queryFn: () => fetch('/api/receiving').then(r => r.json())
    });

    const handleScan = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!scanInput.trim()) return;

        try {
            const res = await fetch('/api/scan/receiving', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: scanInput })
            });
            const data = await res.json();

            setLastScan(data);
            setScanInput('');
            refetch(); // Refresh list

            if (data.matchFound) {
                alert(`MATCH FOUND! Order: ${data.matchDetails?.product_title}`);
            }

        } catch (err) {
            console.error(err);
            setLastScan({ success: false, message: 'Scan failed' });
        }
    };

    const columns = [
        { header: 'Date / Time', accessor: (row: any) => new Date(row.timestamp).toLocaleString() },
        { header: 'Tracking Number', accessor: 'tracking_number' as const, className: 'font-mono' },
        { header: 'Carrier', accessor: 'carrier' as const },
        { header: 'Qty', accessor: 'quantity' as const }, // Placeholder, receiving might not have qty unless we add it
    ];

    if (isLoading) return <div className="p-4 text-sm">Loading receiving data...</div>;

    return (
        <div className="min-h-screen bg-white text-black font-sans pb-20">
            <div className="p-2">
                <div className="mb-4 flex items-center justify-between bg-gray-100 p-3 rounded border border-gray-300">
                    <h1 className="text-xl font-bold text-[#0a192f]">Receiving Dashboard</h1>
                    {lastScan && (
                        <div className={`px-4 py-2 rounded font-bold ${lastScan.matchFound ? 'bg-red-600 text-white animate-pulse' : 'bg-green-100 text-green-800'}`}>
                            {lastScan.message}
                        </div>
                    )}
                </div>

                <DataTable
                    data={receiving}
                    columns={columns}
                    keyField="id"
                    emptyMessage="No receiving scans yet."
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
                            placeholder="Scan Tracking #..."
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
