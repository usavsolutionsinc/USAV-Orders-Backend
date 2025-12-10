'use client';

import { useQuery } from '@tanstack/react-query';
import { DataTable } from '../../components/DataTable';

export default function SkuStockPage() {
    const { data: stock = [], isLoading } = useQuery({
        queryKey: ['sku-stock'],
        queryFn: () => fetch('/api/sku-stock').then(r => r.json())
    });

    const columns = [
        { header: 'SKU', accessor: 'sku' as const, className: 'font-bold' },
        { header: 'Quantity', accessor: 'quantity' as const },
        { header: 'Title', accessor: 'title' as const },
        { header: 'Serial Numbers', accessor: 'serial_numbers' as const },
    ];

    return (
        <div className="min-h-screen bg-white text-black font-sans">
            <div className="p-4">
                <h1 className="text-2xl font-bold mb-4 text-[#0a192f]">SKU Stock</h1>
                {isLoading ? (
                    <div>Loading stock...</div>
                ) : (
                    <DataTable
                        data={stock}
                        columns={columns}
                        keyField="sku"
                        emptyMessage="No stock data found."
                        variant="sheet"
                    />
                )}
            </div>
        </div>
    );
}
