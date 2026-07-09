'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useStaffFilter, type UseStaffFilterResult } from '@/hooks/useStaffFilter';
import { SCOPE_PARAM, parseScope, type StationScope } from '@/lib/station/table-url-params';
import type { StaffMember } from '@/lib/staffCache';

/**
 * `useStationStaffScope` — the two-scope model for station tables
 * (station-table-unification-plan §3.3). A surface is viewed either as **my work**
 * (the signed-in operator's execution view) or **all staff** (supervisor
 * oversight), carried in `?scope=`. The effective staff id passed to queries is:
 *
 *   - `scope=mine` → the signed-in `user.staffId` (the `?staff=` filter is ignored)
 *   - `scope=all`  → the `?staff=` filter if set, else undefined (all staff)
 *
 * Station pages default `mine`; receiving history/incoming default `all`. Composes
 * the canonical {@link useStaffFilter} for the fine-grain picker when `scope=all`.
 */
export interface UseStationStaffScopeResult {
  scope: StationScope;
  setScope: (next: StationScope) => void;
  /** Staff id to pass to the list/counts queries (null = all staff). */
  effectiveStaffId: number | null;
  /** The signed-in operator's staff id, if known. */
  ownStaffId: number | null;
  /** The `?staff=` fine-grain filter (only meaningful when `scope=all`). */
  staffFilter: UseStaffFilterResult;
}

export function useStationStaffScope({
  defaultScope,
  roleFilter,
}: {
  defaultScope: StationScope;
  /** Narrow the picker options to a role (techs in Tech, packers in Packing). */
  roleFilter?: (staff: StaffMember) => boolean;
}): UseStationStaffScopeResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const staffFilter = useStaffFilter(roleFilter ? { roleFilter } : undefined);

  const scope = parseScope(searchParams.get(SCOPE_PARAM), defaultScope);
  const ownStaffId = user?.staffId ?? null;

  const setScope = useCallback(
    (next: StationScope) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === defaultScope) params.delete(SCOPE_PARAM);
      else params.set(SCOPE_PARAM, next);
      // Leaving `all` for `mine` drops the fine-grain staff filter (mine locks it).
      if (next === 'mine') params.delete('staff');
      const qs = params.toString();
      router.replace(qs ? `${pathname || '/'}?${qs}` : pathname || '/', { scroll: false });
    },
    [searchParams, defaultScope, router, pathname],
  );

  const effectiveStaffId = useMemo(
    () => (scope === 'mine' ? ownStaffId : staffFilter.staffId),
    [scope, ownStaffId, staffFilter.staffId],
  );

  return { scope, setScope, effectiveStaffId, ownStaffId, staffFilter };
}
