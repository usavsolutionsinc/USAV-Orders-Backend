'use client';

import { useEffect, useState } from 'react';

export type StaffMember = {
  id: number;
  name: string;
  role: string;
};

export function useActiveStaffDirectory(): StaffMember[] {
  const [staff, setStaff] = useState<StaffMember[]>([]);

  useEffect(() => {
    let isMounted = true;
    const fetchStaff = async () => {
      try {
        const res = await fetch('/api/staff?active=true', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted || !Array.isArray(data)) return;
        setStaff(
          data
            .filter((member: any) => Number.isFinite(Number(member?.id)))
            .map((member: any) => ({
              id: Number(member.id),
              name: String(member.name || '').trim() || `Staff ${member.id}`,
              role: String(member.role || ''),
            })),
        );
      } catch {
        // no-op
      }
    };

    fetchStaff();
    return () => {
      isMounted = false;
    };
  }, []);

  return staff;
}
