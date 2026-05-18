import { Suspense } from 'react';
import { ProductsShell } from '@/components/products/ProductsShell';

export default function ProductsPage() {
    return (
        <div className="flex h-full min-h-0 flex-col">
            <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading…</div>}>
                <ProductsShell />
            </Suspense>
        </div>
    );
}
