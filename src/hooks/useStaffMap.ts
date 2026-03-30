'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useCallback } from 'react';
import { getStationFromEmployeeId, type StationType } from '@/utils/staff-station';

export interface StaffEntry {
  id: number;
  name: string;
  role: string;
  employee_id: string | null;
  station: StationType;
}

async function fetchStaff(): Promise<StaffEntry[]> {
  const res = await fetch('/api/staff?active=true');
  if (!res.ok) return [];
  const data: Array<{ id: number; name: string; role: string; employee_id: string | null }> = await res.json();
  return data.map((s) => ({
    ...s,
    station: getStationFromEmployeeId(s.employee_id),
  }));
}

/**
 * Single cached fetch for the entire active staff list.
 * Station type is derived from employeeId prefix — zero extra DB calls.
 * 5 people = tiny payload, one round trip, 5-min cache.
 */
export function useStaffMap() {
  const { data: staffList = [], isLoading } = useQuery({
    queryKey: ['staff-map'],
    queryFn: fetchStaff,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const staffMap = useMemo(() => {
    const map = new Map<number, StaffEntry>();
    for (const s of staffList) map.set(s.id, s);
    return map;
  }, [staffList]);

  const getStation = useCallback(
    (staffId: number): StationType => staffMap.get(staffId)?.station ?? 'TECH',
    [staffMap],
  );

  return { staffList, staffMap, getStation, isLoading };
}
