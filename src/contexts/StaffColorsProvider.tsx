'use client';

/**
 * Populates the module-level staff color cache in @/utils/staff-colors so the
 * synchronous resolvers (getStaffThemeById, getStaffColorHex) can render
 * without each consumer threading the staff record through props.
 *
 *   • Fetches /api/staff?active=false once on mount and on cache invalidation.
 *   • Pushes results into setStaffColorCache(), which bumps a version and
 *     notifies subscribers via _subscribeStaffColorCache.
 *   • Components that need to re-render on color changes call
 *     useStaffColorVersion() — the hook subscribes to the version counter and
 *     forces a re-render whenever the cache is replaced.
 *
 * Mounted near the top of the app (root layout) so the cache is warm before
 * any staff-colored chrome paints.
 */

import { useEffect, useReducer } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '@/queries/keys';
import {
  setStaffColorCache,
  _subscribeStaffColorCache,
  _getStaffColorVersion,
} from '@/utils/staff-colors';

interface StaffColorRecord {
  id: number;
  color_hex?: string | null;
}

export function StaffColorsProvider({ children }: { children: React.ReactNode }) {
  // Reuses the canonical staff React Query key so updates from the admin
  // staff page (which invalidate qk.staff.all) refresh this cache for free.
  const { data } = useQuery<StaffColorRecord[]>({
    queryKey: qk.staff.all,
    queryFn: async () => {
      const r = await fetch('/api/staff?active=false', { cache: 'no-store' });
      if (!r.ok) return [];
      const json = await r.json();
      return Array.isArray(json) ? json : [];
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (data) setStaffColorCache(data);
  }, [data]);

  return <>{children}</>;
}

/**
 * Subscribes to the module-level color cache version. Components that read
 * getStaffThemeById/getStaffColorHex during render and want to re-render when
 * an admin updates a color should call this hook (the returned value is just
 * a tick counter — discard it).
 */
export function useStaffColorVersion(): number {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => _subscribeStaffColorCache(force), []);
  return _getStaffColorVersion();
}
