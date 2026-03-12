'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, Package, Printer } from '@/components/Icons';
import { FbaShipmentBoard } from '@/components/fba/FbaShipmentBoard';
import { FbaLabelQueue } from '@/components/fba/FbaLabelQueue';

// The left sidebar context (FbaSidebar) lives in DashboardSidebar
// under routeKey === 'fba'. It sets ?status= and ?r= to communicate
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

  // Auto-select label queue tab when sidebar filter is READY_TO_GO
  const [activeTab, setActiveTab] = useState<Tab>(
    statusFilter === 'READY_TO_GO' ? 'labels' : 'summary'
  );

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'summary',
      label: 'Summary',
      icon: <Package className="w-3.5 h-3.5" />,
    },
    {
      id: 'labels',
      label: 'Label Queue',
      icon: <Printer className="w-3.5 h-3.5" />,
    },
  ];

  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-gray-50">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b border-gray-200 bg-white">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-xl text-xs font-black transition-all border-b-2 ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-600 bg-blue-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.id === 'labels' && statusFilter === 'READY_TO_GO' && (
              <span className="ml-1 w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {/* Tab panels */}
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
        <div className="flex h-full w-full items-center justify-center bg-gray-50">
          <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
        </div>
      }
    >
      <FbaPageContent />
    </Suspense>
  );
}
