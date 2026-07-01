'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { LibraryPhoto } from '@/components/photos/photo-library-types';
import type { PhotoDateNav } from '@/components/photos/photo-library-grid/types';
import { photoLibraryFilterParams } from '@/hooks/usePhotoLibrary';
import type { PhotoLibraryFilterState, PhotoLibrarySourceScope } from '@/lib/photos/library-filter-state';
import { getCurrentPSTDateKey } from '@/utils/date';

const PICKER_PAGE_LIMIT = 100;

interface MediaTypeSelection {
  scope?: PhotoLibrarySourceScope;
  imageType?: string;
}

interface UseMediaLibraryPickerPhotosArgs {
  enabled: boolean;
  mediaType: MediaTypeSelection | null;
  ticketTab: boolean;
  ticketId?: number;
  dateNav: PhotoDateNav;
  search?: string;
}

/** Rolling window for the year-folder root — bounds DB reads in the picker. */
function rootFetchDateRange(): Pick<PhotoLibraryFilterState, 'dateFrom' | 'dateTo'> {
  const today = getCurrentPSTDateKey();
  const end = new Date(`${today}T12:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 364);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  return { dateFrom: ymd(start), dateTo: today };
}

function buildPickerFilters({
  mediaType,
  ticketTab,
  ticketId,
  dateNav,
  search,
}: Omit<UseMediaLibraryPickerPhotosArgs, 'enabled'>): PhotoLibraryFilterState | null {
  if (ticketTab) {
    if (!ticketId) return null;
    const base: PhotoLibraryFilterState = {
      sourceScope: 'claims',
      ticketId: String(ticketId),
    };
    if (dateNav.dateFrom && dateNav.dateTo) {
      base.dateFrom = dateNav.dateFrom;
      base.dateTo = dateNav.dateTo;
    }
    return base;
  }

  if (!mediaType) return null;

  const base: PhotoLibraryFilterState = {};
  if (mediaType.scope) base.sourceScope = mediaType.scope;
  if (mediaType.imageType) base.imageType = mediaType.imageType;

  if (search?.trim()) {
    base.q = search.trim();
    if (dateNav.dateFrom && dateNav.dateTo) {
      base.dateFrom = dateNav.dateFrom;
      base.dateTo = dateNav.dateTo;
    } else {
      Object.assign(base, rootFetchDateRange());
    }
    return base;
  }

  if (dateNav.dateFrom && dateNav.dateTo) {
    base.dateFrom = dateNav.dateFrom;
    base.dateTo = dateNav.dateTo;
  } else {
    Object.assign(base, rootFetchDateRange());
  }
  if (dateNav.poRef) base.poRef = dateNav.poRef;
  if (dateNav.ticketId) base.ticketId = dateNav.ticketId;
  return base;
}

/** Date-scoped library fetch for the media picker (single page, max 100 rows). */
export function useMediaLibraryPickerPhotos(args: UseMediaLibraryPickerPhotosArgs) {
  const filters = useMemo(
    () => buildPickerFilters(args),
    [args.mediaType, args.ticketTab, args.ticketId, args.dateNav, args.search],
  );

  const query = useQuery({
    queryKey: ['media-library-picker', filters],
    enabled: args.enabled && filters !== null,
    queryFn: async () => {
      const params = photoLibraryFilterParams(filters!);
      params.set('limit', String(PICKER_PAGE_LIMIT));
      const res = await fetch(`/api/photos/library?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load photos');
      const data = (await res.json()) as { photos: LibraryPhoto[] };
      return data.photos ?? [];
    },
    staleTime: 30_000,
  });

  return { filters, photos: query.data ?? [], query };
}
