'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { useDebounce } from '@/hooks';
import { usePhotoLibraryUrlState } from '@/hooks/usePhotoLibraryUrlState';
import { usePhotoLibrary } from '@/hooks/usePhotoLibrary';
import {
  buildPhotoLibraryRefinements,
  photoLibraryStructuredFilterCount,
} from '@/lib/photos/library-refinements';
import { PhotoFolderTree } from './PhotoFolderTree';
import { PhotoLibraryFilterDropdown } from './PhotoLibraryFilterDropdown';
import { PhotoLibraryNasBackup } from './PhotoLibraryNasBackup';
import { PhotoStationFolders } from './PhotoStationFolders';
import type { StaffRecipient } from '@/components/quick-access/StaffRecipientList';

export function PhotoLibrarySidebarPanel() {
  const { filters, patch, setDatePreset, clearStructured, clearAll } =
    usePhotoLibraryUrlState();
  const { query, photos } = usePhotoLibrary(filters);
  const { data: staffRows = [] } = useQuery<StaffRecipient[]>({
    queryKey: ['staff-picker'],
    queryFn: async () => {
      const res = await fetch('/api/auth/staff-picker', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load staff');
      const data = (await res.json()) as { staff?: StaffRecipient[] };
      return data.staff ?? [];
    },
    staleTime: 10 * 60 * 1000,
  });

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
    () =>
      buildPhotoLibraryRefinements(filters, { patch, setDatePreset, clearStructured }, {
        staffNameForId: (id) => staffRows.find((row) => String(row.id) === id)?.name,
      }),
    [clearStructured, filters, patch, setDatePreset, staffRows],
  );

  const structuredCount = photoLibraryStructuredFilterCount(filters);

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
            staffOptions={staffRows}
          />
        ),
      }}
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
      <PhotoStationFolders
        activeScope={filters.sourceScope ?? 'all'}
        photos={photos}
        filters={filters}
        onSelectScope={(scope) =>
          patch({ sourceScope: scope, dateFrom: undefined, dateTo: undefined, poRef: undefined })
        }
        onSelectDate={(sel) => patch({ dateFrom: sel.dateFrom, dateTo: sel.dateTo, poRef: sel.poRef })}
      />

      <div className="mt-3 border-t border-gray-100 pt-3">
        <PhotoFolderTree
          selectedFolderId={filters.folderId ? Number(filters.folderId) : null}
          onSelectFolder={(id) => patch({ folderId: id ? String(id) : undefined })}
        />
      </div>
    </SidebarShell>
  );
}
