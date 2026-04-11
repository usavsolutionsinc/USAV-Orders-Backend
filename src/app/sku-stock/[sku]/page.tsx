'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import SkuDetailView from '@/components/sku/SkuDetailView';

export default function SkuDetailPage() {
    const { sku } = useParams<{ sku: string }>();
    const decodedSku = decodeURIComponent(sku || '');

    return (
        <Suspense fallback={
            <div className="flex h-full w-full items-center justify-center bg-gray-50">
                <LoadingSpinner size="lg" className="text-blue-600" />
            </div>
        }>
            <SkuDetailView sku={decodedSku} variant="page" />
        </Suspense>
    );
}
