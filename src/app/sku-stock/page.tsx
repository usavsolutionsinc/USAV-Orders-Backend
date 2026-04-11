'use client';

import { Suspense } from 'react';
import SkuBrowser from '@/components/sku/SkuBrowser';
import { MobileSkuStockDashboard } from '@/components/mobile/sku-stock/MobileSkuStockDashboard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useUIMode } from '@/design-system/providers/UIModeProvider';

function SkuStockPageContent() {
    const { isMobile } = useUIMode();

    if (isMobile) {
        return <MobileSkuStockDashboard />;
    }

    return <SkuBrowser />;
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
