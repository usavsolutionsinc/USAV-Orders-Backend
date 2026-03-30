'use client';

import { useEffect, useState } from 'react';
import { getActiveStaff, type StaffMember } from '@/lib/staffCache';

export type { StaffMember };

/**
 * Returns the cached active-staff directory.
 * Uses the singleton cache in staffCache.ts so the fetch happens at most once
 * per page load and the result is shared across all consumers.
 */
export function useActiveStaffDirectory(): StaffMember[] {
  const [staff, setStaff] = useState<StaffMember[]>([]);

  useEffect(() => {
    let isMounted = true;
    getActiveStaff().then((data) => {
      if (isMounted) setStaff(data);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  return staff;
}
