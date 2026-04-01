'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

export type OperationsKpiGranularity = 'hourly' | 'daily';

export type OperationsKpiRow = {
  bucket_start: string;
  environment: string;
  source: string;
  action_type: string;
  actor_staff_id: number | null;
  actor_name: string | null;
  event_count: number;
  error_count: number;
  warning_count: number;
  unique_entities: number;
  first_event_at: string | null;
  last_event_at: string | null;
  updated_at: string;
};

export type OperationsKpiSummary = {
  total_events: number;
  total_errors: number;
  total_warnings: number;
  total_unique_entities: number;
  row_count: number;
};

export type OperationsEventVolumePoint = {
  bucket_start: string;
  event_count: number;
};

export type OperationsDistributionRow = {
  label: string;
  count: number;
  percent: number;
};

export type OperationsCoverage = {
  window_start: string;
  window_end: string;
  total_deduped_events: number;
  by_source_table: Record<string, number>;
  audit_percent: number;
  sal_percent: number;
};

type OperationsKpiResponse = {
  success: boolean;
  granularity: OperationsKpiGranularity;
  rows: OperationsKpiRow[];
  summary: OperationsKpiSummary;
  eventVolume?: OperationsEventVolumePoint[];
  distribution?: OperationsDistributionRow[];
  distributionByStation?: OperationsDistributionRow[];
  coverage?: OperationsCoverage;
};

function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function fetchOperationsKpiTable(params: {
  granularity: OperationsKpiGranularity;
  limit?: number;
  environment?: string;
  start?: string;
  end?: string;
}) {
  const sp = new URLSearchParams();
  sp.set('granularity', params.granularity);
  sp.set('limit', String(params.limit ?? 500));
  if (params.environment) sp.set('environment', params.environment);
  if (params.start) sp.set('start', params.start);
  if (params.end) sp.set('end', params.end);

  const res = await fetch(`/api/operations/kpi-table?${sp.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch operations KPI data');
  const json = (await res.json()) as OperationsKpiResponse;

  const rows: OperationsKpiRow[] = (json.rows || []).map((row) => ({
    ...row,
    event_count: toNum((row as any).event_count),
    error_count: toNum((row as any).error_count),
    warning_count: toNum((row as any).warning_count),
    unique_entities: toNum((row as any).unique_entities),
  }));

  const summary = {
    total_events: toNum((json.summary as any)?.total_events),
    total_errors: toNum((json.summary as any)?.total_errors),
    total_warnings: toNum((json.summary as any)?.total_warnings),
    total_unique_entities: toNum((json.summary as any)?.total_unique_entities),
    row_count: toNum((json.summary as any)?.row_count),
  };

  const eventVolume: OperationsEventVolumePoint[] = (json.eventVolume || []).map((point) => ({
    bucket_start: String((point as any).bucket_start || ''),
    event_count: toNum((point as any).event_count),
  }));

  const distribution: OperationsDistributionRow[] = (json.distribution || []).map((row) => ({
    label: String((row as any).label || 'unknown'),
    count: toNum((row as any).count),
    percent: toNum((row as any).percent),
  }));

  const distributionByStation: OperationsDistributionRow[] = (json.distributionByStation || []).map((row) => ({
    label: String((row as any).label || 'UNKNOWN'),
    count: toNum((row as any).count),
    percent: toNum((row as any).percent),
  }));

  const coverage: OperationsCoverage = {
    window_start: String((json.coverage as any)?.window_start || ''),
    window_end: String((json.coverage as any)?.window_end || ''),
    total_deduped_events: toNum((json.coverage as any)?.total_deduped_events),
    by_source_table: ((json.coverage as any)?.by_source_table || {}) as Record<string, number>,
    audit_percent: toNum((json.coverage as any)?.audit_percent),
    sal_percent: toNum((json.coverage as any)?.sal_percent),
  };

  return { rows, summary, eventVolume, distribution, distributionByStation, coverage };
}

export function useOperationsKpiTable(input: {
  granularity: OperationsKpiGranularity;
  limit?: number;
  environment?: string;
  start?: string;
  end?: string;
}) {
  const query = useQuery({
    queryKey: ['operations-kpi-table', input.granularity, input.limit ?? 500, input.environment ?? 'prod', input.start ?? '', input.end ?? ''],
    queryFn: () => fetchOperationsKpiTable(input),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  return useMemo(
    () => ({
      rows: query.data?.rows ?? [],
      summary: query.data?.summary ?? {
        total_events: 0,
        total_errors: 0,
        total_warnings: 0,
        total_unique_entities: 0,
        row_count: 0,
      },
      eventVolume: query.data?.eventVolume ?? [],
      distribution: query.data?.distribution ?? [],
      distributionByStation: query.data?.distributionByStation ?? [],
      coverage: query.data?.coverage ?? {
        window_start: '',
        window_end: '',
        total_deduped_events: 0,
        by_source_table: {},
        audit_percent: 0,
        sal_percent: 0,
      },
      isLoading: query.isLoading,
      isFetching: query.isFetching,
      error: query.error,
      refetch: query.refetch,
    }),
    [query.data, query.error, query.isFetching, query.isLoading, query.refetch],
  );
}
