'use client';

import { useCallback, useEffect, useState } from 'react';
import { getActiveStaff } from '@/lib/staffCache';

const STAFF_NAME_OVERRIDES: Record<number, string> = {
  7: 'Kai',
};

export function useStaffNameMap() {
  const [staffNameMap, setStaffNameMap] = useState<Record<number, string>>({});

  useEffect(() => {
    let active = true;
    getActiveStaff()
      .then((data) => {
        if (!active) return;
        const nextMap: Record<number, string> = {};
        data.forEach((member) => {
          if (member?.id && member?.name) {
            nextMap[member.id] = STAFF_NAME_OVERRIDES[member.id] ?? member.name;
          }
        });
        Object.assign(nextMap, STAFF_NAME_OVERRIDES);
        setStaffNameMap(nextMap);
      })
      .catch((error) => console.error('Failed to fetch staff name map:', error));
    return () => {
      active = false;
    };
  }, []);

  const getStaffName = useCallback((staffId: number | null | undefined): string => {
    if (!staffId) return '---';
    return STAFF_NAME_OVERRIDES[staffId] ?? staffNameMap[staffId] ?? `#${staffId}`;
  }, [staffNameMap]);

  return {
    staffNameMap,
    getStaffName
  };
}
