'use client';

import { useQuery } from '@tanstack/react-query';
import { DataTable } from '../../components/DataTable';

export default function SkuStockPage() {
    const { data: stock = [], isLoading } = useQuery({
        queryKey: ['sku-stock'],
        queryFn: () => fetch('/api/sku-stock').then(r => r.json())
    });

    // Generate columns dynamically from col_1 to col_5
    const columns = Array.from({ length: 5 }, (_, i) => ({
        header: `col_${i + 1}`,
        accessor: `col_${i + 1}` as const,
        colKey: `col_${i + 1}`,
        className: i === 0 ? 'font-bold' : '' // col_1 is typically SKU
    }));

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
                        keyField="id"
                        emptyMessage="No stock data found."
                        variant="sheet"
                        tableName="sku_stock"
                        showColumnManager={true}
                    />
                )}
            </div>
        </div>
    );
}
