'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { LibraryPhoto } from '@/components/photos/photo-library-types';
import {
  entityTypeForSourceScope,
  type PhotoLibraryFilterState,
} from '@/lib/photos/library-filter-state';

function buildQueryString(filters: PhotoLibraryFilterState, cursor?: number | null): string {
  const params = new URLSearchParams();
  params.set('limit', '48');
  if (cursor) params.set('cursor', String(cursor));
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  const entityType = filters.sourceScope ? entityTypeForSourceScope(filters.sourceScope) : undefined;
  if (entityType) params.set('entityType', entityType);
  if (filters.sort) params.set('sort', filters.sort);
  if (filters.poRef) params.set('poRef', filters.poRef);
  if (filters.receivingId) params.set('receivingId', filters.receivingId);
  if (filters.staffId) params.set('staffId', filters.staffId);
  if (filters.q) params.set('q', filters.q);
  if (filters.damageDetected) params.set('damageDetected', filters.damageDetected);
  if (filters.hasAnalysis) params.set('hasAnalysis', filters.hasAnalysis);
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
