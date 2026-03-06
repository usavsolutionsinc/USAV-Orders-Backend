'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from '@/components/Icons';
import { FbaShipmentBoard } from '@/components/fba/FbaShipmentBoard';

// The left sidebar context (FbaSidebar) lives in DashboardSidebar
// under routeKey === 'fba'. It sets ?status= and ?r= to communicate
// with this right-panel board.

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

  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-gray-50">
      <FbaShipmentBoard
        statusFilter={statusFilter}
        refreshTrigger={refreshTrigger}
        searchQuery={searchQuery}
      />
    </div>
  );
}

export default function FbaPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center bg-gray-50">
          <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
        </div>
      }
    >
      <FbaPageContent />
    </Suspense>
  );
}
