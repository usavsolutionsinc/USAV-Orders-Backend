'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  applyDatePreset,
  clearStructuredPhotoFilters,
  parsePhotoLibraryDisplayParams,
  parsePhotoLibraryFilters,
  photoLibraryUrlParams,
  type PhotoLibraryDatePreset,
  type PhotoLibraryFilterState,
  type PhotoLibrarySourceScope,
  type PhotoLibraryViewMode,
} from '@/lib/photos/library-filter-state';

const PHOTOS_PATH = '/ops/photos';

export function usePhotoLibraryUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () => parsePhotoLibraryFilters(searchParams),
    [searchParams],
  );

  const display = useMemo(
    () => parsePhotoLibraryDisplayParams(searchParams),
    [searchParams],
  );

  const replaceUrl = useCallback(
    (nextFilters: PhotoLibraryFilterState, nextDisplay: typeof display) => {
      const params = photoLibraryUrlParams(nextFilters, nextDisplay, searchParams);
      const qs = params.toString();
      const base = pathname?.startsWith(PHOTOS_PATH) ? pathname : PHOTOS_PATH;
      router.replace(qs ? `${base}?${qs}` : base, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const replaceFilters = useCallback(
    (next: PhotoLibraryFilterState) => {
      replaceUrl(next, { ...display, page: 1 });
    },
    [display, replaceUrl],
  );

  const patch = useCallback(
    (partial: Partial<PhotoLibraryFilterState>) => {
      replaceFilters({ ...filters, ...partial });
    },
    [filters, replaceFilters],
  );

  const setDatePreset = useCallback(
    (preset: PhotoLibraryDatePreset) => {
      const range = applyDatePreset(preset);
      replaceFilters({ ...filters, ...range });
    },
    [filters, replaceFilters],
  );

  const setSourceScope = useCallback(
    (scope: PhotoLibrarySourceScope) => {
      replaceFilters({
        ...filters,
        sourceScope: scope,
      });
    },
    [filters, replaceFilters],
  );

  const setView = useCallback(
    (view: PhotoLibraryViewMode) => {
      replaceUrl(filters, { ...display, view });
    },
    [display, filters, replaceUrl],
  );

  /**
   * Apply a saved view: set the whole filter set AND the view mode in one URL
   * write (page reset to 1). A separate replaceFilters + setView would clobber
   * each other — each reads stale closure state — so this is a single replaceUrl.
   */
  const applyView = useCallback(
    (nextFilters: PhotoLibraryFilterState, nextView: PhotoLibraryViewMode) => {
      replaceUrl(nextFilters, { view: nextView, page: 1 });
    },
    [replaceUrl],
  );

  const setPage = useCallback(
    (page: number) => {
      replaceUrl(filters, { ...display, page: Math.max(1, page) });
    },
    [display, filters, replaceUrl],
  );

  const clearStructured = useCallback(() => {
    replaceFilters(clearStructuredPhotoFilters(filters));
  }, [filters, replaceFilters]);

  const clearAll = useCallback(() => {
    replaceUrl({}, { view: display.view, page: 1 });
  }, [display.view, replaceUrl]);

  return {
    filters,
    display,
    patch,
    setDatePreset,
    setSourceScope,
    setView,
    setPage,
    clearStructured,
    clearAll,
    replaceFilters,
    applyView,
  };
}
