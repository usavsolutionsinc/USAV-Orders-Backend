'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '@/components/DataTable';
import DailyChecklist from '@/components/DailyChecklist';

export default function PackerPage() {
    const params = useParams();
    const packerId = params.id;
    const [scanInput, setScanInput] = useState('');
    const [dailyCount, setDailyCount] = useState(0);

    const { data: packerData = [], isLoading, refetch } = useQuery({
        queryKey: ['packer', packerId],
        queryFn: () => fetch(`/api/packer/${packerId}`).then(r => r.json())
    });

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
                console.log('Scan success:', data);
                if (data.dailyCount !== undefined) {
                    setDailyCount(data.dailyCount);
                }
                refetch(); // Refresh data
            } else {
                alert(data.message);
            }
            setScanInput('');
        } catch (err) {
            console.error(err);
            alert('Scan failed');
        }
    };

    // Generate columns dynamically from col_1 to col_5
    const columns = Array.from({ length: 5 }, (_, i) => ({
        header: `col_${i + 1}`,
        accessor: `col_${i + 1}` as const,
        colKey: `col_${i + 1}`,
        className: i === 1 ? 'font-mono' : '' // col_2 is typically tracking number
    }));

    if (isLoading) return <div className="p-4 text-sm">Loading packer data...</div>;

    return (
        <div className="h-screen bg-white text-black font-sans flex flex-col overflow-hidden">
            <div className="p-2 flex-1 flex flex-col min-h-0">
                <div className="mb-2 flex items-center justify-between bg-gray-100 p-3 rounded border border-gray-300 flex-shrink-0">
                    <div className="flex items-center gap-4">
                        <h1 className="text-xl font-bold text-[#0a192f]">Packer {packerId} Dashboard</h1>
                        <div className="bg-blue-100 text-blue-800 px-3 py-1 rounded font-bold">
                            Today: {dailyCount}
                        </div>
                    </div>
                </div>

                {/* Daily Checklist */}
                <div className="mb-2 flex-shrink-0">
                    <DailyChecklist userId={packerId as string} role="packer" />
                </div>

                <DataTable
                    data={packerData}
                    columns={columns}
                    keyField="id"
                    emptyMessage="No orders assigned."
                    variant="sheet"
                    tableName={`packer_${packerId}`}
                    showColumnManager={true}
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
