'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { sidebarHeaderBandClass, sidebarHeaderRowClass } from '@/components/layout/header-shell';
import { SearchBar } from '@/components/ui/SearchBar';
import { ManualsSidebar } from '@/components/manuals/ManualsSidebar';
import { SkuPairingPanel } from '@/components/manuals/SkuPairingPanel';

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

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* Search bar (shared) */}
      <div className={`${sidebarHeaderBandClass} ${sidebarHeaderRowClass}`}>
        {viewMode === 'manuals' ? (
          <ManualsSearchBar />
        ) : (
          <SkuPairingSearchBar />
        )}
      </div>

      {/* Slider below search */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-3 py-1.5">
        <HorizontalButtonSlider
          items={VIEW_SLIDER_ITEMS}
          value={viewMode}
          onChange={handleViewChange}
          variant="fba"
          size="md"
          aria-label="Manuals view"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'sku-pairing' ? (
          <SkuPairingPanel embedded />
        ) : (
          <ManualsSidebar embedded />
        )}
      </div>
    </div>
  );
}

// ─── Search bars (extracted to keep state isolated per view) ─────────────────

function ManualsSearchBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [localSearch, setLocalSearch] = useState(searchParams.get('q') || '');

  const urlQ = searchParams.get('q') || '';
  useEffect(() => { setLocalSearch(urlQ); }, [urlQ]);

  const handleChange = (value: string) => {
    setLocalSearch(value);
    const params = new URLSearchParams(searchParams.toString());
    if (value.trim()) params.set('q', value.trim());
    else params.delete('q');
    router.replace(`/manuals?${params.toString()}`);
  };

  return (
    <SearchBar
      value={localSearch}
      onChange={handleChange}
      onClear={() => handleChange('')}
      placeholder="Search manuals..."
      variant="blue"
      size="compact"
    />
  );
}

function SkuPairingSearchBar() {
  const [value, setValue] = useState('');

  const handleChange = (v: string) => {
    setValue(v);
    window.dispatchEvent(new CustomEvent('sku-pairing-search', { detail: v }));
  };

  return (
    <SearchBar
      value={value}
      onChange={handleChange}
      onClear={() => handleChange('')}
      placeholder="Search unpaired items..."
      variant="blue"
      size="compact"
    />
  );
}
