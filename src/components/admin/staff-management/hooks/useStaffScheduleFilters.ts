'use client';

/**
 * URL-driven roster filtering for the Staff Schedule tab. Reads `?search=`,
 * `?staffView=`, and `?staffId=` and narrows the roster to the rows the pane
 * should show. Extracted from StaffScheduleTab; behaviour is unchanged.
 */

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import type { useStaffScheduleData } from '@/hooks/admin/useStaffScheduleData';

type StaffList = ReturnType<typeof useStaffScheduleData>['staff'];

export interface StaffScheduleFilters {
  /** The single selected staffer (`?staffId=`), or null when none is picked. */
  selectedStaffId: number | null;
  filteredStaff: StaffList;
}

export function useStaffScheduleFilters(staff: StaffList): StaffScheduleFilters {
  const searchParams = useSearchParams();
  const searchTerm = (searchParams.get('search') || '').trim().toLowerCase();
  const staffView = searchParams.get('staffView') || 'all';
  const selectedStaffId = (() => {
    const raw = searchParams.get('staffId');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const filteredStaff = useMemo(() => {
    return staff.filter((member) => {
      if (selectedStaffId != null && member.id !== selectedStaffId) return false;

      const matchesSearch =
        !searchTerm ||
        member.name.toLowerCase().includes(searchTerm) ||
        (member.employee_id || '').toLowerCase().includes(searchTerm);

      const matchesView =
        staffView === 'active'
          ? Boolean(member.active)
          : staffView === 'inactive'
            ? !member.active
            : staffView === 'technician'
              ? member.role === 'technician'
              : staffView === 'packer'
                ? member.role === 'packer'
                : true;

      return matchesSearch && matchesView;
    });
  }, [searchTerm, staff, staffView, selectedStaffId]);

  return { selectedStaffId, filteredStaff };
}
