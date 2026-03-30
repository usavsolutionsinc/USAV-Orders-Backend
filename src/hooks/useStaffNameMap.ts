'use client';

import { useCallback, useEffect, useState } from 'react';
import { getActiveStaff } from '@/lib/staffCache';
import { STAFF_NAMES } from '@/utils/staff';

export function useStaffNameMap() {
  const [staffNameMap, setStaffNameMap] = useState<Record<number, string>>(STAFF_NAMES);

  useEffect(() => {
    let active = true;
    getActiveStaff()
      .then((data) => {
        if (!active) return;
        const nextMap: Record<number, string> = { ...STAFF_NAMES };
        data.forEach((member) => {
          if (member?.id && member?.name) {
            nextMap[member.id] = STAFF_NAMES[member.id] ?? member.name;
          }
        });
        setStaffNameMap(nextMap);
      })
      .catch((error) => console.error('Failed to fetch staff name map:', error));
    return () => {
      active = false;
    };
  }, []);

  const getStaffName = useCallback((staffId: number | null | undefined): string => {
    if (!staffId) return '---';
    return staffNameMap[staffId] ?? `#${staffId}`;
  }, [staffNameMap]);

  return {
    staffNameMap,
    getStaffName
  };
}
