'use client';

import { useEffect, useState } from 'react';

export type StaffMember = {
  id: number;
  name: string;
  role: string;
};

/** Case-insensitive match on trimmed `name` (e.g. default FBA workspace staff "Lien"). */
export function findStaffIdByNormalizedName(
  directory: StaffMember[],
  normalizedName: string
): number | null {
  const key = normalizedName.trim().toLowerCase();
  const row = directory.find((m) => String(m.name || '').trim().toLowerCase() === key);
  return row?.id ?? null;
}

export function useActiveStaffDirectory(): StaffMember[] {
  const [staff, setStaff] = useState<StaffMember[]>([]);

  useEffect(() => {
    let isMounted = true;
    const fetchStaff = async () => {
      try {
        const res = await fetch('/api/staff?active=true');
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
