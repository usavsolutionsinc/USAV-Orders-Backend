'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toPSTDateKey } from '@/utils/date';
import { useAblyChannel } from './useAblyChannel';

export interface TechRecord {
  id: number;
  source_row_id?: number;
  source_kind?: 'tech_serial' | 'fba_scan' | 'tech_scan';
  tech_serial_id?: number | null;
  order_db_id?: number | null;
  shipment_id?: number | null;
  created_at: string;
  updated_at?: string | null;
  shipping_tracking_number: string;
  serial_number: string;
  tested_by: number;
  ship_by_date?: string | null;
  order_id: string | null;
  fnsku?: string | null;
  /** `fba_fnsku_logs.id` for FNSKU tech scans; pairs fba_scan stub with tech_serial row. */
  fnsku_log_id?: number | null;
  item_number?: string | null;
  product_title: string | null;
  quantity?: string | null;
  condition: string | null;
  sku: string | null;
  status?: string | null;
  status_history?: any;
  account_source?: string | null;
  notes?: string | null;
  out_of_stock?: string | null;
  /** Derived from shipping_tracking_numbers carrier status */
  is_shipped?: boolean;
  shipment_status?: string | null;
}

export interface UseTechLogsOptions {
  weekOffset?: number;
  weekRange?: { startStr: string; endStr: string };
}

function prependTechRecordToMatchingWeekCaches(
  queryClient: QueryClient,
  techId: number,
  record: TechRecord,
) {
  const createdAt = record.created_at || new Date().toISOString();
  const recordDate = toPSTDateKey(createdAt);
  const recordForCache: TechRecord = {
    ...record,
    created_at: record.created_at || createdAt,
  };

  const queries = queryClient.getQueriesData<TechRecord[]>({
    queryKey: ['tech-logs', techId],
  });

  /** Only one week cache mounted — week bounds can disagree with PST (timezone); always prepend. */
  const singleWeekCache = queries.length === 1;

  for (const [queryKey, prev] of queries) {
    if (!prev || !Array.isArray(prev)) continue;
    const weekPart = queryKey[2] as { weekStart?: string; weekEnd?: string } | undefined;
    const start = String(weekPart?.weekStart ?? '').trim();
    const end = String(weekPart?.weekEnd ?? '').trim();
    if (
      !singleWeekCache
      && recordDate
      && start
      && end
      && (recordDate < start || recordDate > end)
    ) {
      continue;
    }
    if (prev.some((r) => r.id === recordForCache.id)) continue;
    queryClient.setQueryData<TechRecord[]>(queryKey, (old) => {
      if (!old) return old;
      if (old.some((r) => r.id === recordForCache.id)) return old;
      return [recordForCache, ...old];
    });
  }
}

const STATION_CHANNEL =
  process.env.NEXT_PUBLIC_ABLY_CHANNEL_STATION_CHANGES || 'station:changes';

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
      // Avoid browser HTTP cache (API sends max-age=120); stale responses overwrite optimistic prepends.
      const res = await fetch(`/api/tech-logs?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch tech logs');
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    // Current week stays fresh for 5 min (matches server 120s TTL + buffer); historical 30 min.
    staleTime: weekOffset === 0 ? 5 * 60 * 1000 : 30 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });

  // ── Ably: live row-level updates from any session (mobile or web) ─────────
  // INSERT with row  → surgical prepend (avoids a full round-trip).
  // INSERT without row → invalidate so the table refetches.
  // UPDATE            → invalidate (covers re-scans, condition/SKU patches).
  // DELETE            → invalidate (TSN id ≠ SAL row id so we can't remove
  //                     surgically; a fresh fetch is the safest approach).
  useAblyChannel(
    STATION_CHANNEL,
    'tech-log.changed',
    (msg: any) => {
      const { techId: changedId, action, row } = msg?.data ?? {};
      if (Number(changedId) !== techId) return;

      if (action === 'insert' && row) {
        prependTechRecordToMatchingWeekCaches(queryClient, techId, row as TechRecord);
      } else if (action === 'insert' || action === 'update' || action === 'delete') {
        // Covers: insert without full row data, updates to existing rows,
        // and deletions (e.g. undo-last) from any client or device.
        queryClient.invalidateQueries({ queryKey: ['tech-logs', techId] });
      }
    },
  );

  // ── Local surgical insert (same-tab tracking scans via CustomEvent) ────────
  // Fired by scan-tracking handler in useStationTestingController only when a
  // new tracking number creates a new row — serial additions do NOT fire this.
  useEffect(() => {
    const handleNewLog = (e: any) => {
      const record = e?.detail as TechRecord | null;
      if (!record) return;
      if (Number(record.tested_by) !== techId) return;
      const rid = record.id;
      if (rid == null || (typeof rid === 'number' && !Number.isFinite(rid))) return;

      prependTechRecordToMatchingWeekCaches(queryClient, techId, record);
    };
    window.addEventListener('tech-log-added', handleNewLog);
    return () => window.removeEventListener('tech-log-added', handleNewLog);
  }, [queryClient, techId]);

  return query;
}
