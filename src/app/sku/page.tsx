'use client';

import { useQuery } from '@tanstack/react-query';
import { DataTable } from '../../components/DataTable';

export default function SkusPage() {
    const { data: skus = [], isLoading } = useQuery({
        queryKey: ['skus'],
        queryFn: () => fetch('/api/skus').then(r => r.json())
    });

    // Generate columns dynamically from col_1 to col_8
    const columns = Array.from({ length: 8 }, (_, i) => ({
        header: `col_${i + 1}`,
        accessor: `col_${i + 1}` as const,
        colKey: `col_${i + 1}`,
        className: i === 1 ? 'font-bold' : '' // col_2 is typically SKU
    }));

    return (
        <div className="min-h-screen bg-white text-black font-sans flex flex-col">
            {/* Checklist Section - Fixed at top after nav */}
            <div className="flex-shrink-0 p-4 border-b border-gray-200">
                <div className="bg-gray-100 p-4 rounded border border-gray-300">
                    <h2 className="text-lg font-bold text-[#0a192f] mb-2">SKU Serial Numbers Checklist</h2>
                    <p className="text-sm text-gray-600">Manage your SKU serial numbers workflow</p>
                </div>
            </div>

            {/* Sheet Section - Full height at bottom */}
            <div className="flex-1 flex flex-col min-h-0">
                {isLoading ? (
                    <div className="p-4">Loading skus...</div>
                ) : (
                    <DataTable
                        data={skus}
                        columns={columns}
                        keyField="id"
                        emptyMessage="No SKU data found."
                        variant="sheet"
                        tableName="skus"
                        showColumnManager={true}
                    />
                )}
            </div>
        </div>
    );
}
