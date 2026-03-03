'use client';

import { Suspense } from 'react';
import SkuBrowser from '@/components/sku/SkuBrowser';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function SkuStockPage() {
    return (
        <Suspense fallback={
            <div className="flex h-full w-full items-center justify-center bg-gray-50">
                <LoadingSpinner size="lg" className="text-blue-600" />
            </div>
        }>
            <SkuBrowser />
        </Suspense>
    );
}
