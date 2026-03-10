'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
      <div className="border-b border-gray-200 bg-white">
        <ViewDropdown
          options={FBA_STATUS_OPTIONS}
          value={activeStatus}
          onChange={(status) => updateFbaParams({ status: status as FbaStatus })}
          variant="boxy"
          buttonClassName="h-full w-full appearance-none text-[10px] font-black uppercase tracking-wider text-gray-700 bg-white px-3 py-3 pr-8 hover:bg-gray-50 transition-all rounded-none outline-none text-left"
          optionClassName="text-[10px] font-black tracking-wider"
        />
      </div>

      {/* Search bar */}
      <div className="border-b border-gray-200 bg-white px-3 py-2">
        <SearchBar
          value={localSearch}
          onChange={setLocalSearch}
          onClear={() => setLocalSearch('')}
          placeholder="Search FNSKU, product, ASIN, SKU..."
          variant="purple"
        />
      </div>

      {/* Shipment stats + new-shipment form */}
      <div className="flex-1 overflow-y-auto">
        <FbaSidebar onShipmentCreated={() => updateFbaParams({ r: String(Date.now()) })} />
      </div>
    </div>
  );
}
