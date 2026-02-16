'use client';

import { useCallback, useEffect, useState } from 'react';

interface StaffRecord {
  id: number;
  name: string;
}

export function useStaffNameMap() {
  const [staffNameMap, setStaffNameMap] = useState<Record<number, string>>({});

  useEffect(() => {
    let active = true;

    const fetchStaff = async () => {
      try {
        const res = await fetch('/api/staff?active=true', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!active || !Array.isArray(data)) return;

        const nextMap: Record<number, string> = {};
        data.forEach((member: StaffRecord) => {
          if (member?.id && member?.name) {
            nextMap[member.id] = member.name;
          }
        });
        setStaffNameMap(nextMap);
      } catch (error) {
        console.error('Failed to fetch staff name map:', error);
      }
    };

    fetchStaff();

    return () => {
      active = false;
    };
  }, []);

  const getStaffName = useCallback((staffId: number | null | undefined): string => {
    if (!staffId) return '---';
    return staffNameMap[staffId] || `#${staffId}`;
  }, [staffNameMap]);

  return {
    staffNameMap,
    getStaffName
  };
}
