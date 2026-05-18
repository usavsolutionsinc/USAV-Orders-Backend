'use client';

import { Loader2 } from '@/components/Icons';
import { ProductsTableRow } from './ProductsTableRow';
import type { ProductListRow } from './types';

interface ProductsTableProps {
    rows: ProductListRow[];
    isLoading: boolean;
    isFetchingMore: boolean;
    hasMore: boolean;
    onLoadMore: () => void;
    error: string | null;
}

export function ProductsTable({
    rows,
    isLoading,
    isFetchingMore,
    hasMore,
    onLoadMore,
    error,
}: ProductsTableProps) {
    if (isLoading && rows.length === 0) {
        return (
            <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="ml-2 text-sm">Loading products…</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="mx-4 my-8 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:mx-6">
                Failed to load products: {error}
            </div>
        );
    }

    if (rows.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-center">
                <p className="text-sm font-medium text-gray-700">No products match these filters</p>
                <p className="mt-1 text-xs text-gray-500">Try clearing the search or filter pills.</p>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-6xl">
            <div className="hidden gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-gray-500 sm:flex sm:px-6">
                <div className="w-10" />
                <div className="flex-1">SKU · Title</div>
                <div className="w-32">Category</div>
                <div className="w-32">GTIN</div>
                <div className="w-16">Link</div>
                <div className="w-24" />
                <div className="w-4" />
            </div>

            <div role="list">
                {rows.map((row) => (
                    <ProductsTableRow key={row.id} row={row} />
                ))}
            </div>

            {hasMore ? (
                <div className="flex justify-center py-6">
                    <button
                        type="button"
                        onClick={onLoadMore}
                        disabled={isFetchingMore}
                        className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
                    >
                        {isFetchingMore ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : null}
                        Load more
                    </button>
                </div>
            ) : (
                <div className="py-6 text-center text-xs text-gray-400">End of catalog</div>
            )}
        </div>
    );
}
