'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from '@/components/Icons';
import { sidebarHeaderBandClass, sidebarHeaderControlClass, sidebarHeaderRowClass } from '@/components/layout/header-shell';
import { SearchBar } from '@/components/ui/SearchBar';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import { FbaSidebar } from '@/components/fba/FbaSidebar';

type FbaStatus = 'ALL' | 'PLANNED' | 'READY_TO_GO' | 'LABEL_ASSIGNED' | 'SHIPPED';

const FBA_STATUS_OPTIONS: Array<{ value: FbaStatus; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'PLANNED', label: 'Planned' },
  { value: 'READY_TO_GO', label: 'Ready to Go' },
  { value: 'LABEL_ASSIGNED', label: 'Label Assigned' },
  { value: 'SHIPPED', label: 'Shipped' },
];

export function FbaSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeStatus = (searchParams.get('status')?.toUpperCase() || 'ALL') as FbaStatus;
  const [localSearch, setLocalSearch] = useState(searchParams.get('q') || '');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const updateFbaParams = (patch: { status?: FbaStatus; q?: string; r?: string }) => {
    const params = new URLSearchParams(searchParams.toString());
    if (patch.status !== undefined) {
      if (patch.status === 'ALL') params.delete('status');
      else params.set('status', patch.status);
    }
    if (patch.q !== undefined) {
      if (patch.q.trim()) params.set('q', patch.q.trim());
      else params.delete('q');
    }
    if (patch.r !== undefined) params.set('r', patch.r);
    router.replace(`/fba?${params.toString()}`);
  };

  // Debounce search query to URL
  useEffect(() => {
    const t = setTimeout(() => updateFbaParams({ q: localSearch }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSearch]);

  // Sync if URL q changes externally
  const urlQ = searchParams.get('q') || '';
  useEffect(() => {
    setLocalSearch(urlQ);
  }, [urlQ]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Status filter */}
      <div className={sidebarHeaderBandClass}>
        <ViewDropdown
          options={FBA_STATUS_OPTIONS}
          value={activeStatus}
          onChange={(status) => updateFbaParams({ status: status as FbaStatus })}
          variant="boxy"
          buttonClassName={sidebarHeaderControlClass}
          optionClassName="text-[10px] font-black tracking-wider"
        />
      </div>

      {/* Search bar */}
      <div className={`${sidebarHeaderBandClass} ${sidebarHeaderRowClass}`}>
        <SearchBar
          value={localSearch}
          onChange={setLocalSearch}
          onClear={() => setLocalSearch('')}
          placeholder="Search FNSKU, product, ASIN, SKU..."
          variant="purple"
          rightElement={
            <button
              type="button"
              onClick={() => setShowCreateForm((current) => !current)}
              className="rounded-xl bg-purple-600 p-2.5 text-white transition-all active:scale-95 hover:bg-purple-700 shadow-lg shadow-purple-600/20"
              title="New Shipment"
              aria-label="Open new shipment form"
            >
              <Plus className="w-4 h-4" />
            </button>
          }
        />
      </div>

      {/* Shipment stats + new-shipment form */}
      <div className="flex-1 overflow-y-auto">
        <FbaSidebar
          onShipmentCreated={() => updateFbaParams({ r: String(Date.now()) })}
          showCreateForm={showCreateForm}
          onCreateFormChange={setShowCreateForm}
        />
      </div>
    </div>
  );
}
