'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { RouteShell } from '@/design-system/components/RouteShell';
import { SkuStockSidebarPanel } from '@/components/sidebar/SkuStockSidebarPanel';
import { LocationDetailView } from '@/components/sku/LocationDetailView';

function LocationPageContent() {
  const params = useParams<{ barcode: string }>();
  const barcode = decodeURIComponent(params?.barcode || '').trim();

  return (
    <RouteShell
      actions={<SkuStockSidebarPanel />}
      history={<LocationDetailView barcode={barcode} />}
    />
  );
}

export default function SkuStockLocationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center bg-gray-50">
          <LoadingSpinner size="lg" className="text-blue-600" />
        </div>
      }
    >
      <LocationPageContent />
    </Suspense>
  );
}
