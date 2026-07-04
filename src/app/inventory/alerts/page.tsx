import { Suspense } from 'react';
import { InventoryShell } from '@/components/inventory/InventoryShell';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function InventoryAlertsPage() {
    return (
        <div className="flex h-full min-h-0 flex-col">
            <Suspense
                fallback={
                    <div className="flex h-full w-full items-center justify-center bg-surface-canvas">
                        <LoadingSpinner size="lg" className="text-blue-600" />
                    </div>
                }
            >
                <InventoryShell />
            </Suspense>
        </div>
    );
}
