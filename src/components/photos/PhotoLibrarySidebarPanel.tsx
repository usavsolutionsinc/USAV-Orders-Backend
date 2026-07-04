'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { useDebounce } from '@/hooks';
import { usePhotoLibraryUrlState } from '@/hooks/usePhotoLibraryUrlState';
import { usePhotoLibraryDefaultMediaType } from '@/hooks/usePhotoLibraryDefaultMediaType';
import { usePhotoLibrary } from '@/hooks/usePhotoLibrary';
import {
  sourceScopeFromFilters,
  todayFoldersDateFilter,
  type PhotoLibrarySourceScope,
} from '@/lib/photos/library-filter-state';
import {
  buildPhotoLibraryRefinements,
  photoLibraryStructuredFilterCount,
} from '@/lib/photos/library-refinements';
import { PhotoLibraryFilterDropdown } from './PhotoLibraryFilterDropdown';
import { PhotoLibraryNasBackup } from './PhotoLibraryNasBackup';
import { PhotoStationFolders } from './PhotoStationFolders';
import { PhotoLabelsSection } from './PhotoLabelsSection';
import { MediaSavedViewsSection } from './MediaSavedViewsSection';
import { useAuth } from '@/contexts/AuthContext';
import type { StaffRecipient } from '@/components/quick-access/StaffRecipientList';

const SEARCH_PLACEHOLDER = 'PO, order, tracking, serial, ticket, or text…';

export function PhotoLibrarySidebarPanel() {
  const { filters, display, patch, setDatePreset, clearStructured, applyView } =
    usePhotoLibraryUrlState();
  usePhotoLibraryDefaultMediaType(filters, patch);
  const { has } = useAuth();
  const canManagePhotos = has('photos.manage');
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

  const [searchInput, setSearchInput] = useState(filters.poFinder ?? filters.q ?? '');
  const debouncedInput = useDebounce(searchInput, 250);

  useEffect(() => {
    setSearchInput(filters.poFinder ?? filters.q ?? '');
  }, [filters.q, filters.poFinder]);

  useEffect(() => {
    const trimmed = debouncedInput.trim();
    if (trimmed === (filters.poFinder ?? '')) return;
    patch({
      poFinder: trimmed || undefined,
      poFinderKind: trimmed ? 'any' : undefined,
      q: undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedInput]);

  const refinements = useMemo(
    () =>
      buildPhotoLibraryRefinements(filters, { patch, setDatePreset, clearStructured }, {
        staffNameForId: (id) => staffRows.find((row) => String(row.id) === id)?.name,
      }),
    [clearStructured, filters, patch, setDatePreset, staffRows],
  );

  const structuredCount = photoLibraryStructuredFilterCount(filters);
  const activeScope = sourceScopeFromFilters(filters);

  const inferredScope = useMemo<PhotoLibrarySourceScope | null>(() => {
    if (activeScope !== 'all' || !filters.poRef) return null;
    const counts = new Map<PhotoLibrarySourceScope, number>();
    for (const photo of photos) {
      if (photo.sourceScope) counts.set(photo.sourceScope, (counts.get(photo.sourceScope) ?? 0) + 1);
    }
    let best: PhotoLibrarySourceScope | null = null;
    let bestCount = 0;
    for (const [scope, count] of counts) {
      if (count > bestCount) {
        best = scope;
        bestCount = count;
      }
    }
    return best;
  }, [activeScope, filters.poRef, photos]);

  return (
    <SidebarShell
      className="bg-surface-card"
      search={{
        value: searchInput,
        onChange: setSearchInput,
        onClear: () => setSearchInput(''),
        placeholder: SEARCH_PLACEHOLDER,
        isSearching: query.isFetching && !query.isLoading,
        variant: 'blue',
      }}
      filter={{
        label: 'Media filters',
        refinements,
        activeCount: structuredCount,
        onClearAll: clearStructured,
        renderDropdown: (onClose) => (
          <PhotoLibraryFilterDropdown
            filters={filters}
            onPatch={patch}
            onClose={onClose}
            staffOptions={staffRows}
          />
        ),
      }}
      bodyClassName="scrollbar-hide pb-2 pt-2"
      footer={
        <div className="space-y-1 border-t border-border-hairline px-3 py-2">
          <PhotoLibraryNasBackup />
        </div>
      }
    >
      <MediaSavedViewsSection
        currentFilters={filters}
        currentView={display.view}
        savable={
          structuredCount > 0 ||
          !!filters.poFinder ||
          !!filters.q ||
          !!filters.imageType ||
          !!filters.label ||
          (!!filters.sourceScope && filters.sourceScope !== 'all') ||
          display.view !== 'folders'
        }
        canManage={canManagePhotos}
        onApply={(payload) => applyView(payload.filters, payload.view)}
      />
      <PhotoStationFolders
        activeScope={activeScope}
        activeImageType={filters.imageType ?? null}
        activeDocumentType={filters.documentType ?? 'all'}
        activeOutboundMedia={filters.outboundMedia ?? 'documents'}
        inferredScope={inferredScope}
        onSelect={({ scope, imageType }) =>
          patch({
            sourceScope: scope,
            imageType,
            documentType: scope === 'outbound' ? filters.documentType ?? 'all' : undefined,
            outboundMedia: scope === 'outbound' ? filters.outboundMedia ?? 'documents' : undefined,
            ...todayFoldersDateFilter(),
            poRef: undefined,
            label: undefined,
          })
        }
        onDocumentTypeSelect={(documentType) => patch({ documentType, outboundMedia: 'documents' })}
        onPackPhotosSelect={() => patch({ outboundMedia: 'pack_photos', documentType: undefined })}
      />
      <PhotoLabelsSection
        activeLabel={filters.label ?? null}
        scopeImageType={filters.imageType}
        onSelect={(label) => patch({ label })}
      />
    </SidebarShell>
  );
}
