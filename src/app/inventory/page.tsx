import { Suspense } from 'react';
import { InventoryDesignDemo } from '@/components/inventory/demo/InventoryDesignDemo';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function InventoryPage() {
    return (
        <div className="flex h-full min-h-0 flex-col">
            <Suspense
                fallback={
                    <div className="flex h-full w-full items-center justify-center bg-gray-50">
                        <LoadingSpinner size="lg" className="text-blue-600" />
                    </div>
                }
            >
                <InventoryDesignDemo />
            </Suspense>
        </div>
    );
}
