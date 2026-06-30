'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { Button } from '@/design-system/primitives';
import { useDebounce } from '@/hooks';
import { usePhotoLibraryUrlState } from '@/hooks/usePhotoLibraryUrlState';
import { usePhotoLibrary } from '@/hooks/usePhotoLibrary';
import {
  sourceScopeFromFilters,
  todayFoldersDateFilter,
  PHOTO_SEARCH_FIELDS,
  PHOTO_SEARCH_FIELD_LABELS,
  finderKindForField,
  fieldForFinderKind,
  type PhotoLibrarySourceScope,
  type PhotoSearchField,
} from '@/lib/photos/library-filter-state';
import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import {
  buildPhotoLibraryRefinements,
  photoLibraryStructuredFilterCount,
} from '@/lib/photos/library-refinements';
import { PhotoLibraryFilterDropdown } from './PhotoLibraryFilterDropdown';
import { PhotoLibraryNasBackup } from './PhotoLibraryNasBackup';
import { PhotoStationFolders } from './PhotoStationFolders';
import { PhotoLabelsSection } from './PhotoLabelsSection';
import type { StaffRecipient } from '@/components/quick-access/StaffRecipientList';

const SEARCH_FIELD_ITEMS = PHOTO_SEARCH_FIELDS.map((field) => ({
  id: field,
  label: PHOTO_SEARCH_FIELD_LABELS[field],
}));

/** Placeholder reflects the active field-scope so the operator knows what resolves. */
const SEARCH_FIELD_PLACEHOLDERS: Record<PhotoSearchField, string> = {
  all: 'PO, order, tracking, serial, or text…',
  po: 'Find photos by PO #…',
  order: "Order # → that PO's photos…",
  tracking: "Tracking # → that PO's photos…",
  serial: "Serial # → that PO's photos…",
};

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

  // One search box → the unified PO-photo finder (`poFinder` + `poFinderKind`).
  // 'All' resolves the typed value across serial/tracking/order/PO (+ text/OCR);
  // a specific field forces that one path. Either way it surfaces the PO's photos.
  const [searchInput, setSearchInput] = useState(filters.poFinder ?? filters.q ?? '');
  const [searchField, setSearchField] = useState<PhotoSearchField>(
    fieldForFinderKind(filters.poFinderKind),
  );
  const debouncedInput = useDebounce(searchInput, 250);

  // Re-hydrate the box + scope when the URL changes out-of-band (deep link,
  // clear-all). Our own patches land back here harmlessly (same value in → out).
  // A legacy/deep-link `?q=` (no poFinder) hydrates the box under the 'All' scope.
  useEffect(() => {
    setSearchInput(filters.poFinder ?? filters.q ?? '');
    setSearchField(fieldForFinderKind(filters.poFinderKind));
  }, [filters.q, filters.poFinder, filters.poFinderKind]);

  useEffect(() => {
    const trimmed = debouncedInput.trim();
    const kind = finderKindForField(searchField);
    const already = trimmed === (filters.poFinder ?? '') && kind === (filters.poFinderKind ?? 'any');
    if (already) return;
    patch({
      poFinder: trimmed || undefined,
      poFinderKind: trimmed ? kind : undefined,
      q: undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedInput, searchField]);

  const refinements = useMemo(
    () =>
      buildPhotoLibraryRefinements(filters, { patch, setDatePreset, clearStructured }, {
        staffNameForId: (id) => staffRows.find((row) => String(row.id) === id)?.name,
      }),
    [clearStructured, filters, patch, setDatePreset, staffRows],
  );

  const structuredCount = photoLibraryStructuredFilterCount(filters);
  const activeScope = sourceScopeFromFilters(filters);

  // When inside a PO folder under "All photos" (no explicit scope), highlight the
  // image-type row the folder's photos belong to — the dominant derived scope
  // across the loaded contact sheet. An explicit scope drives the highlight itself.
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
      className="bg-white"
      search={{
        value: searchInput,
        onChange: setSearchInput,
        onClear: () => setSearchInput(''),
        placeholder: SEARCH_FIELD_PLACEHOLDERS[searchField],
        isSearching: query.isFetching && !query.isLoading,
        variant: 'blue',
      }}
      headerRows={[
        <HorizontalButtonSlider
          key="photo-search-field"
          variant="nav"
          dense
          items={SEARCH_FIELD_ITEMS}
          value={searchField}
          onChange={(id) => setSearchField(id as PhotoSearchField)}
        />,
      ]}
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
        <div className="space-y-1 border-t border-gray-100 px-3 py-2">
          <PhotoLibraryNasBackup />
        </div>
      }
    >
      {refinements.length > 0 || filters.q || filters.poFinder ? (
        <div className="mb-3 px-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="h-auto rounded-none px-0 text-micro font-bold uppercase tracking-wider text-gray-400 hover:bg-transparent hover:text-gray-900"
          >
            Clear all filters
          </Button>
        </div>
      ) : null}
      <PhotoStationFolders
        activeScope={activeScope}
        activeImageType={filters.imageType ?? null}
        inferredScope={inferredScope}
        onSelect={({ scope, imageType }) =>
          patch({
            sourceScope: scope,
            imageType,
            ...todayFoldersDateFilter(),
            poRef: undefined,
            // Selecting a different type clears a stale label refinement.
            label: undefined,
          })
        }
      />
      <PhotoLabelsSection
        activeLabel={filters.label ?? null}
        scopeImageType={filters.imageType}
        onSelect={(label) => patch({ label })}
      />
    </SidebarShell>
  );
}
