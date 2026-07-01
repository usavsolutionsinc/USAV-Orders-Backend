'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_PHOTO_GRID_DENSITY,
  isPhotoGridDensity,
  PHOTO_GRID_DENSITY_STORAGE_KEY,
  type PhotoGridDensity,
} from '@/lib/photos/photo-grid-density';

/** Persists grid tile density in localStorage — shared by library + pickers. */
export function usePhotoGridDensity() {
  const [density, setDensityState] = useState<PhotoGridDensity>(DEFAULT_PHOTO_GRID_DENSITY);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PHOTO_GRID_DENSITY_STORAGE_KEY);
      if (stored && isPhotoGridDensity(stored)) setDensityState(stored);
    } catch {
      // private browsing / blocked storage — keep default
    }
  }, []);

  const setDensity = useCallback((next: PhotoGridDensity) => {
    setDensityState(next);
    try {
      localStorage.setItem(PHOTO_GRID_DENSITY_STORAGE_KEY, next);
    } catch {
      // best-effort persist
    }
  }, []);

  return { density, setDensity };
}
