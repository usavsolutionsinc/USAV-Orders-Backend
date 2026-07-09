'use client';

import { useQuery } from '@tanstack/react-query';

export interface PackingKpiResponse {
  ok: boolean;
  day: string;
  capacity: {
    packer_headcount: number;
    workday_minutes: number;
    daily_capacity_minutes: number;
    daily_medium_target: number;
    daily_large_target: number;
  };
  totals: {
    small_count: number;
    medium_count: number;
    large_count: number;
    weighted_minutes: number;
    remaining_minutes: number;
  };
  by_packer: Array<{
    staff_id: number;
    staff_name: string | null;
    small_count: number;
    medium_count: number;
    large_count: number;
    weighted_minutes: number;
  }>;
  fba: {
    pending_units: number;
    pending_weighted_minutes: number;
    avg_minutes_per_unit: number | null;
    fillable_units: number;
  };
}

async function safeJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function usePackingKpi(day?: string) {
  return useQuery<PackingKpiResponse | null>({
    queryKey: ['packing-kpi', day ?? 'today'],
    staleTime: 30_000,
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (day) sp.set('day', day);
      const url = `/api/packing/kpi${sp.toString() ? `?${sp.toString()}` : ''}`;
      return await safeJson<PackingKpiResponse>(url);
    },
  });
}

