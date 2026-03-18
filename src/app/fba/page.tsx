'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from '@/components/Icons';
import { FbaShipmentBoard } from '@/components/fba/FbaShipmentBoard';
import { FbaLabelQueue } from '@/components/fba/FbaLabelQueue';

// The left sidebar context (FbaSidebar) lives in DashboardSidebar
// under routeKey === 'fba'. It sets ?status=, ?tab=, and ?r= to communicate
// with this right-panel board.

type Tab = 'summary' | 'labels';

function FbaPageContent() {
  const searchParams = useSearchParams();
  const rawStatus = (searchParams.get('status') || 'ALL').toUpperCase();
  const statusFilter = (
    ['ALL', 'PLANNED', 'READY_TO_GO', 'LABEL_ASSIGNED', 'SHIPPED'].includes(rawStatus)
      ? rawStatus
      : 'ALL'
  ) as 'ALL' | 'PLANNED' | 'READY_TO_GO' | 'LABEL_ASSIGNED' | 'SHIPPED';
  const refreshTrigger = Number(searchParams.get('r') || 0);
  const searchQuery = searchParams.get('q') || '';
  const activeTab: Tab = searchParams.get('tab') === 'labels' ? 'labels' : 'summary';

  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-white">
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'summary' ? (
          <FbaShipmentBoard
            statusFilter={statusFilter}
            refreshTrigger={refreshTrigger}
            searchQuery={searchQuery}
          />
        ) : (
          <FbaLabelQueue refreshTrigger={refreshTrigger} />
        )}
      </div>
    </div>
  );
}

export default function FbaPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center bg-white">
          <Loader2 className="h-8 w-8 animate-spin text-gray-900" />
        </div>
      }
    >
      <FbaPageContent />
    </Suspense>
  );
}
