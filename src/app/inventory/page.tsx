import { Suspense } from 'react';
import { InventoryV2Shell } from '@/components/inventory-v2/InventoryV2Shell';
import { InventoryMovedBanner } from '@/components/inventory-v2/InventoryMovedBanner';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function InventoryPage() {
    return (
        <div className="flex h-full min-h-0 flex-col">
            <InventoryMovedBanner />
            <Suspense
                fallback={
                    <div className="flex h-full w-full items-center justify-center bg-gray-50">
                        <LoadingSpinner size="lg" className="text-blue-600" />
                    </div>
                }
            >
                <InventoryV2Shell />
            </Suspense>
        </div>
    );
}
