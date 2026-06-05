import { Suspense } from 'react';
import { SkuGraphWorkspace } from '@/components/inventory/graph/SkuGraphWorkspace';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export default function InventoryGraphPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Suspense
        fallback={
          <div className="flex h-full w-full items-center justify-center bg-gray-50">
            <LoadingSpinner size="lg" className="text-blue-600" />
          </div>
        }
      >
        <SkuGraphWorkspace />
      </Suspense>
    </div>
  );
}
