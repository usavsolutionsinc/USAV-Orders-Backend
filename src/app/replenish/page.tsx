'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from '@/components/Icons';
import { ReplenishmentNeedTable } from '@/components/replenish/ReplenishmentNeedTable';
import { ReplenishmentReceivingTab } from '@/components/replenish/ReplenishmentReceivingTab';
import { ReplenishmentShippedFifoTab } from '@/components/replenish/ReplenishmentShippedFifoTab';

type ReplenishTab = 'need' | 'incoming' | 'fifo';

function ReplenishPageContent() {
  const searchParams = useSearchParams();
  const tab = (searchParams.get('tab') as ReplenishTab) || 'need';
  const skuSearch = searchParams.get('sku') || '';
  const statusFilter = searchParams.get('status') || null;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'need' ? (
          <ReplenishmentNeedTable skuSearch={skuSearch} statusFilter={statusFilter} />
        ) : tab === 'incoming' ? (
          <ReplenishmentReceivingTab skuSearch={skuSearch} />
        ) : (
          <ReplenishmentShippedFifoTab skuSearch={skuSearch} />
        )}
      </div>
    </div>
  );
}

export default function ReplenishPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center bg-gray-50">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      }
    >
      <ReplenishPageContent />
    </Suspense>
  );
}
