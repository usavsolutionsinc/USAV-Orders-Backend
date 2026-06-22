'use client';

import { useEffect, useState } from 'react';
import { getActiveStaff } from '@/lib/staffCache';
import { staffHasRole } from '@/utils/staff';

export interface TechStaff {
  id: number;
  name: string;
}

/**
 * Loads the data the repair intake wizard needs up front: the technician
 * directory (filtered from active staff) and the SKU issue labels for the
 * selected favorite (or the default issue list).
 */
export function useRepairIntakeData(favoriteSkuId?: number | null) {
  const [techs, setTechs] = useState<TechStaff[]>([]);
  const [loadingTechs, setLoadingTechs] = useState(true);
  const [skuIssues, setSkuIssues] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    getActiveStaff()
      .then((data) => {
        if (active) setTechs(data.filter((m) => staffHasRole(m, 'technician')));
      })
      .catch(() => setTechs([]))
      .finally(() => setLoadingTechs(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const url = favoriteSkuId
      ? `/api/repair/issues?favoriteSkuId=${favoriteSkuId}`
      : '/api/repair/issues';
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (active) setSkuIssues(
          Array.isArray(data?.issues) ? data.issues.map((i: { label: string }) => i.label) : [],
        );
      })
      .catch(() => { if (active) setSkuIssues([]); });
    return () => { active = false; };
  }, [favoriteSkuId]);

  return { techs, loadingTechs, skuIssues };
}
