'use client';

import { useQuery } from '@tanstack/react-query';
import type { StaffOption } from './shipped-filter-constants';

/** Active staff for tester / packed-by dropdowns (10min cache). */
export function useStaffOptions() {
  const { data: allStaff = [] } = useQuery<StaffOption[]>({
    queryKey: ['staff', 'active'],
    queryFn: async () => {
      const res = await fetch('/api/staff?active=true');
      if (!res.ok) throw new Error('staff fetch failed');
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });
  return { allStaff, techs: allStaff, packers: allStaff };
}
