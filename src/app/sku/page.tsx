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
        <div className="h-screen bg-white text-black font-sans flex flex-col overflow-hidden">
            <div className="flex-1 flex flex-col min-h-0 p-2">
                <h1 className="text-xl font-bold mb-2 text-[#0a192f] flex-shrink-0">SKU Serial Numbers</h1>
                {isLoading ? (
                    <div>Loading skus...</div>
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
