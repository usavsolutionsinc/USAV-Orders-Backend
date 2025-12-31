'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DataTable } from '@/components/DataTable';

interface PriorityItem {
    trackingNumber: string;
    orderNumber: string;
    id: string;
}

export default function ReceivingPage() {
    const [scanInput, setScanInput] = useState('');
    const [lastScan, setLastScan] = useState<{ message: string; success: boolean; matchFound?: boolean } | null>(null);
    const [priorityList, setPriorityList] = useState<PriorityItem[]>(() => {
        if (typeof window === 'undefined') return [];
        try {
            const stored = localStorage.getItem('receiving_priority_list');
            return stored ? JSON.parse(stored) : [];
        } catch {
            return [];
        }
    });
    const [showPriority, setShowPriority] = useState(false);
    const [showAddPriority, setShowAddPriority] = useState(false);
    const [priorityTracking, setPriorityTracking] = useState('');
    const [priorityOrder, setPriorityOrder] = useState('');

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

    const handleAddToPriority = () => {
        if (!priorityTracking.trim()) return;
        const newItem: PriorityItem = {
            trackingNumber: priorityTracking.trim(),
            orderNumber: priorityOrder.trim(),
            id: Date.now().toString()
        };
        const updated = [...priorityList, newItem];
        setPriorityList(updated);
        localStorage.setItem('receiving_priority_list', JSON.stringify(updated));
        setPriorityTracking('');
        setPriorityOrder('');
        setShowAddPriority(false);
    };

    const handleRemovePriority = (id: string) => {
        const updated = priorityList.filter(item => item.id !== id);
        setPriorityList(updated);
        localStorage.setItem('receiving_priority_list', JSON.stringify(updated));
    };

    // Generate columns dynamically from col_1 to col_4
    const columns = Array.from({ length: 4 }, (_, i) => ({
        header: `col_${i + 1}`,
        accessor: `col_${i + 1}` as const,
        colKey: `col_${i + 1}`,
        className: i === 1 ? 'font-mono' : '' // col_2 is typically tracking number
    }));

    if (isLoading) return <div className="p-4 text-sm">Loading receiving data...</div>;

    return (
        <div className="min-h-screen bg-white text-black font-sans flex flex-col">
            {/* Checklist Section - Fixed at top after nav */}
            <div className="flex-shrink-0 p-4 border-b border-gray-200">
                <div className="bg-gray-100 p-4 rounded border border-gray-300">
                    <div className="flex items-center justify-between mb-2">
                        <h2 className="text-lg font-bold text-[#0a192f]">Receiving Dashboard</h2>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setShowPriority(!showPriority)}
                                className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                            >
                                Priority List ({priorityList.length})
                            </button>
                            {lastScan && (
                                <div className={`px-4 py-2 rounded font-bold ${lastScan.matchFound ? 'bg-red-600 text-white animate-pulse' : 'bg-green-100 text-green-800'}`}>
                                    {lastScan.message}
                                </div>
                            )}
                        </div>
                    </div>
                    {showPriority && (
                        <div className="mt-3 p-3 bg-yellow-50 border border-yellow-300 rounded">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-bold text-sm">Priority List</h3>
                                <button
                                    onClick={() => setShowAddPriority(!showAddPriority)}
                                    className="px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600"
                                >
                                    {showAddPriority ? 'Cancel' : '+ Add'}
                                </button>
                            </div>
                            {showAddPriority && (
                                <div className="mb-2 p-2 bg-white rounded border">
                                    <div className="flex gap-2 mb-2">
                                        <input
                                            type="text"
                                            value={priorityTracking}
                                            onChange={(e) => setPriorityTracking(e.target.value)}
                                            placeholder="Tracking Number"
                                            className="px-2 py-1 border rounded text-sm flex-1"
                                        />
                                        <input
                                            type="text"
                                            value={priorityOrder}
                                            onChange={(e) => setPriorityOrder(e.target.value)}
                                            placeholder="Order Number"
                                            className="px-2 py-1 border rounded text-sm flex-1"
                                        />
                                        <button
                                            onClick={handleAddToPriority}
                                            className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
                                        >
                                            Add
                                        </button>
                                    </div>
                                </div>
                            )}
                            <div className="max-h-32 overflow-y-auto">
                                {priorityList.length === 0 ? (
                                    <p className="text-xs text-gray-500">No priority items</p>
                                ) : (
                                    <div className="space-y-1">
                                        {priorityList.map((item) => (
                                            <div key={item.id} className="flex items-center justify-between p-2 bg-white rounded border text-xs">
                                                <div>
                                                    <span className="font-semibold">Tracking: {item.trackingNumber}</span>
                                                    {item.orderNumber && <span className="ml-2">Order: {item.orderNumber}</span>}
                                                </div>
                                                <button
                                                    onClick={() => handleRemovePriority(item.id)}
                                                    className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Sheet Section - Full height at bottom */}
            <div className="flex-1 flex flex-col min-h-0">
                <DataTable
                    data={receiving}
                    columns={columns}
                    keyField="id"
                    emptyMessage="No receiving scans yet."
                    variant="sheet"
                    tableName="receiving"
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
