'use client';

/**
 * First-week ROI rollup for the Operations → Analytics mode.
 *
 * Reads ONLY the org-scoped GET /api/operations/roi (captured throughput from
 * workflow_node_stats + units/labor-hour + cycle-by-stage + units stuck). No
 * cross-tenant data, no polling — a 5-minute staleTime keeps it a glance metric,
 * not a live feed (the neon-cost rule). A non-OK / unsuccessful response resolves
 * to null so the section renders its teaching empty state instead of throwing.
 */

import { useQuery } from '@tanstack/react-query';

export interface RoiCycleStage {
  stage: string;
  avgCycleHours: number;
  samples: number;
}

export interface RoiPerStaff {
  staffId: number;
  staffName: string;
  unitsProcessed: number;
  laborHours: number;
  unitsPerLaborHour: number;
}

export interface OperationsRoiData {
  hasData: boolean;
  unitsThisWeek: number;
  unitsLastWeek: number;
  pctChange: number;
  unitsPerLaborHour: number;
  unitsProcessed: number;
  laborHours: number;
  perStaff: RoiPerStaff[];
  avgCycleHoursByStage: RoiCycleStage[];
  unitsStuck: number;
  generatedAt: string;
}

interface RoiResponse extends OperationsRoiData {
  success: boolean;
}

async function fetchRoi(): Promise<OperationsRoiData | null> {
  try {
    const res = await fetch('/api/operations/roi', { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as RoiResponse;
    if (!json?.success) return null;
    return json;
  } catch {
    return null;
  }
}

export function useOperationsRoi() {
  return useQuery<OperationsRoiData | null>({
    queryKey: ['ops-roi'],
    staleTime: 5 * 60_000,
    queryFn: fetchRoi,
  });
}
