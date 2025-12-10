'use client';

import { useQuery } from '@tanstack/react-query';
import { DataTable } from '../../components/DataTable';

export default function SkusPage() {
    const { data: skus = [], isLoading } = useQuery({
        queryKey: ['skus'],
        queryFn: () => fetch('/api/skus').then(r => r.json())
    });

    const columns = [
        { header: 'SKU', accessor: 'sku' as const, className: 'font-bold' },
        { header: 'Serial Numbers', accessor: 'serial_numbers' as const },
        { header: 'Notes', accessor: 'notes' as const },
    ];

    return (
        <div className="min-h-screen bg-white text-black font-sans">
            <div className="p-4">
                <h1 className="text-2xl font-bold mb-4 text-[#0a192f]">SKU Serial Numbers</h1>
                {isLoading ? (
                    <div>Loading skus...</div>
                ) : (
                    <DataTable
                        data={skus}
                        columns={columns}
                        keyField="sku"
                        emptyMessage="No SKU data found."
                        variant="sheet"
                    />
                )}
            </div>
        </div>
    );
}
