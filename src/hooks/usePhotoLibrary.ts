'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { LibraryPhoto } from '@/components/photos/photo-library-types';
import {
  entityTypeForSourceScope,
  PHOTO_LIBRARY_PAGE_SIZE,
  photoLibraryFiltersToParams,
  receivingSourceExcludeForScope,
  receivingSourceForScope,
  type PhotoLibraryFilterState,
} from '@/lib/photos/library-filter-state';

/**
 * Map UI filter state → `/api/photos/library` query params. Builds on
 * {@link photoLibraryFiltersToParams} (URL parity) then expands scope→entityType
 * and renames keys the API expects (`photoType`, not `imageType`).
 *
 * Uses cursor pagination ({@link PHOTO_LIBRARY_PAGE_SIZE} per page) — the grid
 * loads more via infinite scroll; never fetches the full library in one request.
 */
export function photoLibraryFilterParams(filters: PhotoLibraryFilterState): URLSearchParams {
  const params = photoLibraryFiltersToParams(filters);

  if (filters.sourceScope === 'outbound') {
    params.set('sourceScope', 'outbound');
    params.delete('entityType');
    params.delete('receivingSource');
    params.delete('receivingSourceExclude');
    params.delete('photoType');
    params.delete('imageType');
    if (filters.outboundMedia === 'pack_photos') {
      params.set('outboundMedia', 'pack_photos');
      params.set('entityType', 'PACKER_LOG');
      params.delete('documentType');
    } else {
      params.delete('outboundMedia');
      if (filters.documentType && filters.documentType !== 'all') {
        params.set('documentType', filters.documentType);
      } else {
        params.delete('documentType');
      }
    }
    return params;
  }

  params.delete('sourceScope');
  params.delete('documentType');
  params.delete('outboundMedia');

  const entityType = filters.sourceScope ? entityTypeForSourceScope(filters.sourceScope) : undefined;
  if (entityType) params.set('entityType', entityType);
  else params.delete('entityType');

  if (filters.sourceScope) {
    const includeSource = receivingSourceForScope(filters.sourceScope);
    if (includeSource) params.set('receivingSource', includeSource);
    else params.delete('receivingSource');
    const excludeSource = receivingSourceExcludeForScope(filters.sourceScope);
    if (excludeSource) params.set('receivingSourceExclude', excludeSource);
    else params.delete('receivingSourceExclude');
  } else {
    params.delete('receivingSource');
    params.delete('receivingSourceExclude');
  }

  if (filters.imageType) {
    params.delete('imageType');
    params.set('photoType', filters.imageType);
  } else {
    params.delete('photoType');
  }

  return params;
}

function buildQueryString(filters: PhotoLibraryFilterState, cursor?: number | null): string {
  const params = photoLibraryFilterParams(filters);
  params.set('limit', String(PHOTO_LIBRARY_PAGE_SIZE));
  if (cursor) params.set('cursor', String(cursor));
  return params.toString();
}

export function usePhotoLibrary(filters: PhotoLibraryFilterState) {
  const queryKey = useMemo(() => ['photo-library', filters], [filters]);

  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }) => {
      const qs = buildQueryString(filters, pageParam);
      const res = await fetch(`/api/photos/library?${qs}`);
      if (!res.ok) throw new Error('Failed to load photos');
      return res.json() as Promise<{
        photos: LibraryPhoto[];
        nextCursor: number | null;
        hasMore: boolean;
      }>;
    },
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
  });

  const photos = useMemo(
    () => query.data?.pages.flatMap((p) => p.photos) ?? [],
    [query.data],
  );

  return { query, photos };
}
