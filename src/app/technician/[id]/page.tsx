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
    const [dailyCount, setDailyCount] = useState(0);

    const { data: techData = [], isLoading, refetch } = useQuery({
        queryKey: ['tech', techId],
        queryFn: () => fetch(`/api/tech/${techId}`).then(r => r.json())
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

    // Generate columns dynamically from col_1 to col_8
    const columns = Array.from({ length: 8 }, (_, i) => ({
        header: `col_${i + 1}`,
        accessor: `col_${i + 1}` as const,
        colKey: `col_${i + 1}`,
        className: i === 2 ? 'font-mono' : '' // col_3 is typically tracking number
    }));

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
                    data={techData}
                    columns={columns}
                    keyField="id"
                    emptyMessage="Scan a tracking number to load order."
                    variant="sheet"
                    tableName={`tech_${techId}`}
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
