'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getActiveStaff, type StaffMember } from '@/lib/staffCache';
import type { StaffOption } from '@/components/shipping/StaffButtonGrid';

/**
 * Canonical URL param for the universal all-staff ↔ single-staff filter
 * (P1-WORK-02). One key, one convention, every mode. Absent / blank / 0 = ALL
 * staff (the default behavior of every mode). A positive integer = one staff.
 */
export const STAFF_FILTER_PARAM = 'staff';

export function parseStaffParam(raw: string | null | undefined): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface UseStaffFilterResult {
  /** The currently selected staff id, or null for ALL staff (default). */
  staffId: number | null;
  /** All active staff, for the picker options. Empty until loaded. */
  options: StaffOption[];
  /** Loaded display name for the selected staff (for the active pill). */
  selectedName: string | null;
  /** Select one staff (writes `?staff=`) or pass null to reset to ALL. */
  setStaff: (id: number | null) => void;
}

/**
 * Shared all-staff ↔ single-staff filter state, threaded through the URL
 * (`?staff=`) so it survives refresh, deep-links, and is consistent across
 * every mode. Defaults to ALL staff (param absent), so every mode keeps its
 * current behavior until a staff is explicitly selected.
 *
 * Optionally scope the picker options to a role (e.g. only show techs in the
 * Tech mode, only packers in Packing) — purely a display narrowing; it never
 * changes the URL convention.
 */
export function useStaffFilter(options?: { roleFilter?: (staff: StaffMember) => boolean }): UseStaffFilterResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const roleFilter = options?.roleFilter;

  const [staff, setStaffList] = useState<StaffMember[]>([]);
  useEffect(() => {
    let alive = true;
    getActiveStaff()
      .then((list) => {
        if (alive) setStaffList(list);
      })
      .catch(() => {
        /* staffCache already swallows; keep options empty */
      });
    return () => {
      alive = false;
    };
  }, []);

  const staffId = parseStaffParam(searchParams.get(STAFF_FILTER_PARAM));

  const pickerStaff = useMemo(
    () => (roleFilter ? staff.filter(roleFilter) : staff),
    [staff, roleFilter],
  );

  const pickerOptions = useMemo<StaffOption[]>(
    () => pickerStaff.map((m) => ({ id: m.id, name: m.name })),
    [pickerStaff],
  );

  const selectedName = useMemo(() => {
    if (staffId == null) return null;
    return staff.find((m) => m.id === staffId)?.name ?? null;
  }, [staff, staffId]);

  const setStaff = useCallback(
    (id: number | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id != null && id > 0) params.set(STAFF_FILTER_PARAM, String(id));
      else params.delete(STAFF_FILTER_PARAM);
      const qs = params.toString();
      router.replace(qs ? `${pathname || '/'}?${qs}` : pathname || '/', { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return { staffId, options: pickerOptions, selectedName, setStaff };
}
