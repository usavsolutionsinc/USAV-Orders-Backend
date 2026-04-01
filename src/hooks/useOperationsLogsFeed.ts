'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

export type OperationsFeedItem = {
  id: string;
  timestamp: string;
  actor: string;
  summary: string;
};

type AdminLogsRow = {
  event_id: string;
  created_at: string;
  actor_staff_id: number | null;
  actor_name: string | null;
  action: string;
  source: string | null;
  detail_value: string | null;
};

async function fetchOperationsFeed(limit = 40): Promise<OperationsFeedItem[]> {
  const res = await fetch(`/api/admin/logs?limit=${limit}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch operations feed');
  const json = await res.json();
  const rows = (json?.rows || []) as AdminLogsRow[];

  return rows.map((row) => {
    const actor = row.actor_name || (row.actor_staff_id ? `Staff #${row.actor_staff_id}` : 'SYSTEM');
    const source = row.source ? `${row.source} ` : '';
    const detail = row.detail_value ? ` - ${row.detail_value}` : '';
    return {
      id: row.event_id,
      timestamp: row.created_at,
      actor,
      summary: `${source}${row.action}${detail}`.trim(),
    };
  });
}

export function useOperationsLogsFeed(limit = 40) {
  const query = useQuery({
    queryKey: ['operations-logs-feed', limit],
    queryFn: () => fetchOperationsFeed(limit),
    staleTime: 15_000,
    gcTime: 5 * 60_000,
  });

  return useMemo(
    () => ({
      items: query.data ?? [],
      isLoading: query.isLoading,
      isFetching: query.isFetching,
      error: query.error,
      refetch: query.refetch,
    }),
    [query.data, query.error, query.isFetching, query.isLoading, query.refetch],
  );
}
