'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export interface TechRecord {
  id: number;
  order_db_id?: number | null;
  test_date_time: string;
  shipping_tracking_number: string;
  serial_number: string;
  tested_by: number;
  ship_by_date?: string | null;
  created_at?: string | null;
  order_id: string | null;
  item_number?: string | null;
  product_title: string | null;
  quantity?: string | null;
  condition: string | null;
  sku: string | null;
  account_source?: string | null;
  notes?: string | null;
  out_of_stock?: string | null;
  is_shipped?: boolean;
}

export interface UseTechLogsOptions {
  weekOffset?: number;
  weekRange?: { startStr: string; endStr: string };
}

export function useTechLogs(techId: number, options: UseTechLogsOptions = {}) {
  const { weekOffset = 0, weekRange } = options;
  const queryClient = useQueryClient();
  const queryKey = [
    'tech-logs',
    techId,
    { weekStart: weekRange?.startStr ?? '', weekEnd: weekRange?.endStr ?? '' },
  ] as const;

  const query = useQuery<TechRecord[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ techId: String(techId), limit: '1000' });
      if (weekRange) {
        params.set('weekStart', weekRange.startStr);
        params.set('weekEnd', weekRange.endStr);
      }
      const res = await fetch(`/api/tech-logs?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch tech logs');
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    // Current week stays fresh for 2 min so new scans appear quickly;
    // historical weeks are cached for 30 min (Redis holds them for 24 h).
    staleTime: weekOffset === 0 ? 2 * 60 * 1000 : 30 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });

  // Surgical insert: prepend the brand-new row without a network round-trip.
  // The server already updated its Redis cache via prependToTechLogsCache.
  useEffect(() => {
    const handleNewLog = (e: any) => {
      const record = e?.detail as TechRecord | null;
      if (!record?.id || record.tested_by !== techId) return;

      const currentWeek = (() => {
        const d = new Date();
        // Approximate PST offset (-7h) to match client-side computeWeekRange
        const pstMs = d.getTime() - 7 * 60 * 60 * 1000;
        const pst = new Date(pstMs);
        const dow = pst.getUTCDay();
        const daysFromMonday = dow === 0 ? 6 : dow - 1;
        const mon = new Date(pstMs - daysFromMonday * 86400000);
        const fri = new Date(pstMs + (4 - daysFromMonday) * 86400000);
        const fmt = (x: Date) =>
          `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
        return { startStr: fmt(mon), endStr: fmt(fri) };
      })();

      queryClient.setQueryData<TechRecord[]>(
        ['tech-logs', techId, { weekStart: currentWeek.startStr, weekEnd: currentWeek.endStr }],
        (prev) => {
          if (!prev) return undefined;
          if (prev.some((r) => r.id === record.id)) return prev;
          return [record, ...prev];
        },
      );
    };
    window.addEventListener('tech-log-added', handleNewLog);
    return () => window.removeEventListener('tech-log-added', handleNewLog);
  }, [queryClient, techId]);

  // Full invalidation for serial updates, deletes, and other external changes.
  useEffect(() => {
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['tech-logs', techId] });
    };
    window.addEventListener('usav-refresh-data', handleRefresh);
    return () => window.removeEventListener('usav-refresh-data', handleRefresh);
  }, [queryClient, techId]);

  return query;
}
