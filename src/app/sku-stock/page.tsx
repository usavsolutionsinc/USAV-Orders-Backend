'use client';

import { Suspense } from 'react';
import SkuBrowser from '@/components/sku/SkuBrowser';
import { SkuStockSidebarPanel } from '@/components/sidebar/SkuStockSidebarPanel';
import { RouteShell } from '@/design-system/components/RouteShell';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

function SkuStockPageContent() {
    return (
        <RouteShell
            actions={<SkuStockSidebarPanel />}
            history={<SkuBrowser />}
        />
    );
}

export default function SkuStockPage() {
    return (
        <Suspense fallback={
            <div className="flex h-full w-full items-center justify-center bg-gray-50">
                <LoadingSpinner size="lg" className="text-blue-600" />
            </div>
        }>
            <SkuStockPageContent />
        </Suspense>
    );
}
