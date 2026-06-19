'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { useDebounce } from '@/hooks';
import { usePhotoLibraryUrlState } from '@/hooks/usePhotoLibraryUrlState';
import { usePhotoLibrary } from '@/hooks/usePhotoLibrary';
import {
  buildPhotoLibraryRefinements,
  datePresetFromFilters,
  photoLibraryStructuredFilterCount,
} from '@/lib/photos/library-refinements';
import { PhotoLibraryFilterDropdown } from './PhotoLibraryFilterDropdown';
import { PhotoLibraryNasBackup } from './PhotoLibraryNasBackup';
import { PhotoLibrarySidebarNav } from './PhotoLibrarySidebarNav';

const DATE_QUICK_ITEMS: HorizontalSliderItem[] = [
  { id: 'all', label: 'All dates' },
  { id: 'today', label: 'Today' },
  { id: 'last7', label: '7d' },
];

export function PhotoLibrarySidebarPanel() {
  const router = useRouter();
  const { filters, patch, setDatePreset, setSourceScope, clearStructured, clearAll } =
    usePhotoLibraryUrlState();
  const { query } = usePhotoLibrary(filters);

  const [searchInput, setSearchInput] = useState(filters.q ?? '');
  const debouncedQ = useDebounce(searchInput, 250);

  useEffect(() => {
    setSearchInput(filters.q ?? '');
  }, [filters.q]);

  useEffect(() => {
    const trimmed = debouncedQ.trim();
    if (trimmed === (filters.q ?? '')) return;
    patch({ q: trimmed || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const refinements = useMemo(
    () => buildPhotoLibraryRefinements(filters, { patch, setDatePreset, clearStructured }),
    [filters, patch, setDatePreset, clearStructured],
  );

  const structuredCount = photoLibraryStructuredFilterCount(filters);
  const datePreset = datePresetFromFilters(filters);
  const dateQuickValue =
    datePreset === 'today' ? 'today' : datePreset === 'last7' ? 'last7' : 'all';

  const handleDateQuick = useCallback(
    (id: string) => {
      if (id === 'all') setDatePreset('all');
      else if (id === 'today') setDatePreset('today');
      else if (id === 'last7') setDatePreset('last7');
    },
    [setDatePreset],
  );

  const handleNavigateRecent = useCallback(
    (href: string) => {
      router.push(href);
    },
    [router],
  );

  return (
    <SidebarShell
      className="bg-white"
      search={{
        value: searchInput,
        onChange: setSearchInput,
        onClear: () => setSearchInput(''),
        placeholder: 'PO, tracking, or text in photo…',
        isSearching: query.isFetching && !query.isLoading,
        variant: 'blue',
      }}
      filter={{
        label: 'Photo filters',
        refinements,
        activeCount: structuredCount,
        onClearAll: clearStructured,
        renderDropdown: (onClose) => (
          <PhotoLibraryFilterDropdown
            filters={filters}
            onPatch={patch}
            onDatePreset={setDatePreset}
            onClose={onClose}
          />
        ),
      }}
      headerRows={[
        <HorizontalButtonSlider
          key="date-quick"
          items={DATE_QUICK_ITEMS}
          value={dateQuickValue}
          onChange={handleDateQuick}
          variant="nav"
          dense
          aria-label="Quick date range"
          className="w-full"
        />,
      ]}
      bodyClassName="scrollbar-hide pb-2 pt-2"
      footer={
        <div className="border-t border-gray-100 px-3 py-2">
          <PhotoLibraryNasBackup />
        </div>
      }
    >
      {refinements.length > 0 || filters.q ? (
        <div className="mb-3 px-1">
          <button
            type="button"
            onClick={clearAll}
            className="text-micro font-bold uppercase tracking-wider text-gray-400 hover:text-gray-900"
          >
            Clear all filters
          </button>
        </div>
      ) : null}
      <PhotoLibrarySidebarNav
        filters={filters}
        onSelectScope={setSourceScope}
        onNavigateRecent={handleNavigateRecent}
      />
    </SidebarShell>
  );
}
