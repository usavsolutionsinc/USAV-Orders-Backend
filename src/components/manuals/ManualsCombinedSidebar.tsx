'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { ManualsSidebar } from '@/components/manuals/ManualsSidebar';
import { SkuPairingMovedCard } from '@/components/manuals/SkuPairingMovedCard';

const VIEW_SLIDER_ITEMS: HorizontalSliderItem[] = [
  { id: 'manuals', label: 'Manuals', tone: 'blue' },
  { id: 'sku-pairing', label: 'SKU Pairing', tone: 'orange' },
];

export function ManualsCombinedSidebar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewMode = searchParams.get('view') === 'sku-pairing' ? 'sku-pairing' : 'manuals';

  const handleViewChange = useCallback((id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id === 'manuals') {
      params.delete('view');
    } else {
      params.set('view', id);
    }
    params.delete('id');
    const query = params.toString();
    router.replace(query ? `/manuals?${query}` : '/manuals');
  }, [router, searchParams]);

  // Manuals view search → URL ?q (was the extracted ManualsSearchBar).
  const urlQ = searchParams.get('q') || '';
  const [manualsSearch, setManualsSearch] = useState(urlQ);
  useEffect(() => { setManualsSearch(urlQ); }, [urlQ]);
  const handleManualsChange = (value: string) => {
    setManualsSearch(value);
    const params = new URLSearchParams(searchParams.toString());
    if (value.trim()) params.set('q', value.trim());
    else params.delete('q');
    router.replace(`/manuals?${params.toString()}`);
  };

  // SKU-pairing view search → local state + broadcast event (was SkuPairingSearchBar).
  const [pairingSearch, setPairingSearch] = useState('');
  const handlePairingChange = (v: string) => {
    setPairingSearch(v);
    window.dispatchEvent(new CustomEvent('sku-pairing-search', { detail: v }));
  };

  const isManuals = viewMode === 'manuals';

  return (
    <SidebarShell
      className="bg-white"
      search={
        isManuals
          ? {
              value: manualsSearch,
              onChange: handleManualsChange,
              onClear: () => handleManualsChange(''),
              placeholder: 'Search manuals...',
              variant: 'blue',
            }
          : {
              value: pairingSearch,
              onChange: handlePairingChange,
              onClear: () => handlePairingChange(''),
              placeholder: 'Search unpaired items...',
              variant: 'blue',
            }
      }
      headerBelow={
        <div className={`border-b border-gray-200 bg-white ${SIDEBAR_GUTTER} py-1.5`}>
          <HorizontalButtonSlider
            items={VIEW_SLIDER_ITEMS}
            value={viewMode}
            onChange={handleViewChange}
            variant="fba"
            size="md"
            aria-label="Manuals view"
          />
        </div>
      }
      bodyClassName="overflow-hidden p-0"
    >
      {viewMode === 'sku-pairing' ? <SkuPairingMovedCard /> : <ManualsSidebar embedded />}
    </SidebarShell>
  );
}
