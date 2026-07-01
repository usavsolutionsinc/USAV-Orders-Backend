'use client';

import { useEffect } from 'react';
import {
  defaultPhotoLibraryMediaTypePatch,
  isPhotoLibraryMediaTypeUnset,
  type PhotoLibraryFilterState,
} from '@/lib/photos/library-filter-state';

/**
 * Pins the first built-in media type when the library opens without one.
 * Media type lives outside the filter bar — this only sets `sourceScope` /
 * `imageType`, not structured refinements.
 */
export function usePhotoLibraryDefaultMediaType(
  filters: PhotoLibraryFilterState,
  patch: (partial: Partial<PhotoLibraryFilterState>) => void,
) {
  useEffect(() => {
    if (!isPhotoLibraryMediaTypeUnset(filters)) return;
    patch(defaultPhotoLibraryMediaTypePatch());
  }, [filters.imageType, filters.sourceScope, patch, filters]);
}
