'use client';

import { useQuery } from '@tanstack/react-query';
import { DataTable } from '../../components/DataTable';
import { useState } from 'react';

export default function LogsPage() {
    const [filter, setFilter] = useState('all');

    const { data: logs = [], isLoading } = useQuery({
        queryKey: ['logs', filter],
        queryFn: () => fetch(`/api/logs?type=${filter}`).then(r => r.json())
    });

    const columns = [
        { header: 'Timestamp', accessor: (row: any) => new Date(row.timestamp).toLocaleString() },
        { header: 'Source', accessor: 'source' as const, className: 'uppercase font-bold text-xs' },
        { header: 'User ID', accessor: 'user_id' as const },
        { header: 'Tracking #', accessor: 'tracking_number' as const, className: 'font-mono' },
        { header: 'Action', accessor: 'action' as const },
        { header: 'Details', accessor: 'details' as const },
    ];

    return (
        <div className="min-h-screen bg-white text-black font-sans">
            <div className="p-4">
                <div className="flex justify-between items-center mb-4">
                    <h1 className="text-2xl font-bold text-[#0a192f]">System Logs</h1>
                    <select
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="border border-gray-300 rounded px-3 py-1"
                    >
                        <option value="all">All Logs</option>
                        <option value="packer">Packer Logs</option>
                        <option value="technician">Technician Logs</option>
                        <option value="receiving">Receiving Logs</option>
                    </select>
                </div>

                {isLoading ? (
                    <div>Loading logs...</div>
                ) : (
                    <DataTable
                        data={logs}
                        columns={columns}
                        keyField="id"
                        emptyMessage="No logs found."
                        variant="sheet"
                    />
                )}
            </div>
        </div>
    );
}
