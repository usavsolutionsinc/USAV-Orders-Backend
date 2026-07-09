import { Suspense } from 'react';
import { ProductsWorkspace } from '@/components/products/ProductsWorkspace';

export default function ProductsPage() {
    return (
        <div className="flex h-full min-h-0 flex-col">
            <Suspense fallback={<div className="p-6 text-sm text-text-faint">Loading…</div>}>
                <ProductsWorkspace />
            </Suspense>
        </div>
    );
}
