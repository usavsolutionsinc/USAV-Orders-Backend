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
        <div className="min-h-screen bg-white text-black font-sans flex flex-col">
            {/* Checklist Section - Fixed at top after nav */}
            <div className="flex-shrink-0 p-4 border-b border-gray-200">
                <div className="bg-gray-100 p-4 rounded border border-gray-300">
                    <h2 className="text-lg font-bold text-[#0a192f] mb-2">SKU Stock Checklist</h2>
                    <p className="text-sm text-gray-600">Manage your SKU stock workflow</p>
                </div>
            </div>

            {/* Sheet Section - Full height at bottom */}
            <div className="flex-1 flex flex-col min-h-0">
                {isLoading ? (
                    <div className="p-4">Loading stock...</div>
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
