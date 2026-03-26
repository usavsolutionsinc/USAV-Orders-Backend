'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAblyChannel } from './useAblyChannel';

export interface PackerRecord {
  id: number;
  /** `packer_logs.id` when present; DELETE uses this (not station_activity_logs.id). */
  packer_log_id?: number | null;
  created_at: string;
  scan_ref: string | null;
  shipping_tracking_number: string;
  packed_by: number;
  tracking_type: string | null;
  order_id: string | null;
  order_row_id?: number | null;
  shipment_id?: number | null;
  account_source: string | null;
  product_title: string | null;
  quantity?: string | null;
  item_number?: string | null;
  condition: string | null;
  sku: string | null;
  notes?: string | null;
  status_history?: any;
  ship_by_date?: string | null;
  deadline_at?: string | null;
  serial_number?: string | null;
  tester_id?: number | null;
  tested_by?: number | null;
  test_date_time?: string | null;
  tested_by_name?: string | null;
  tester_name?: string | null;
  packed_by_name?: string | null;
  packer_photos_url: any[];
}

export interface UsePackerLogsOptions {
  weekOffset?: number;
  weekRange?: { startStr: string; endStr: string };
}

/** Compute PST Mon–Fri range for the current week. */
function computeCurrentPSTWeek(): { startStr: string; endStr: string } {
  const d = new Date();
  const pstMs = d.getTime() - 7 * 60 * 60 * 1000;
  const pst = new Date(pstMs);
  const dow = pst.getUTCDay();
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  const mon = new Date(pstMs - daysFromMonday * 86400000);
  const fri = new Date(pstMs + (4 - daysFromMonday) * 86400000);
  const fmt = (x: Date) =>
    `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
  return { startStr: fmt(mon), endStr: fmt(fri) };
}

const STATION_CHANNEL =
  process.env.NEXT_PUBLIC_ABLY_CHANNEL_STATION_CHANGES || 'station:changes';

export function usePackerLogs(packerId: number, options: UsePackerLogsOptions = {}) {
  const { weekOffset = 0, weekRange } = options;
  const queryClient = useQueryClient();
  const queryKey = [
    'packer-logs',
    packerId,
    { weekStart: weekRange?.startStr ?? '', weekEnd: weekRange?.endStr ?? '' },
  ] as const;

  const query = useQuery<PackerRecord[]>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ packerId: String(packerId), limit: '1000' });
      if (weekRange) {
        params.set('weekStart', weekRange.startStr);
        params.set('weekEnd', weekRange.endStr);
      }
      const res = await fetch(`/api/packerlogs?${params}`);
      if (!res.ok) throw new Error('Failed to fetch packer logs');
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: weekOffset === 0 ? 2 * 60 * 1000 : 30 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });

  // ── Ably: live row-level updates from any session (mobile or web) ─────────
  useAblyChannel(
    STATION_CHANNEL,
    'packer-log.changed',
    (msg: any) => {
      const { packerId: changedId, action, row } = msg?.data ?? {};
      if (Number(changedId) !== packerId) return;

      if (action === 'insert' && row) {
        const currentWeek = computeCurrentPSTWeek();
        queryClient.setQueryData<PackerRecord[]>(
          ['packer-logs', packerId, { weekStart: currentWeek.startStr, weekEnd: currentWeek.endStr }],
          (prev) => {
            if (!prev) return undefined;
            if (prev.some((r) => r.id === (row as PackerRecord).id)) return prev;
            return [row as PackerRecord, ...prev];
          },
        );
      } else {
        queryClient.invalidateQueries({ queryKey: ['packer-logs', packerId] });
      }
    },
  );

  // ── Local surgical insert (same-tab scans dispatched via CustomEvent) ─────
  useEffect(() => {
    const handleNewLog = (e: any) => {
      const record = e?.detail as PackerRecord | null;
      if (!record?.id || record.packed_by !== packerId) return;

      const currentWeek = computeCurrentPSTWeek();
      queryClient.setQueryData<PackerRecord[]>(
        ['packer-logs', packerId, { weekStart: currentWeek.startStr, weekEnd: currentWeek.endStr }],
        (prev) => {
          if (!prev) return undefined;
          if (prev.some((r) => r.id === record.id)) return prev;
          return [record, ...prev];
        },
      );
    };
    window.addEventListener('packer-log-added', handleNewLog);
    return () => window.removeEventListener('packer-log-added', handleNewLog);
  }, [queryClient, packerId]);

  // ── Full invalidation for manual refreshes ────────────────────────────────
  useEffect(() => {
    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['packer-logs', packerId] });
    };
    window.addEventListener('usav-refresh-data', handleRefresh);
    return () => window.removeEventListener('usav-refresh-data', handleRefresh);
  }, [queryClient, packerId]);

  return query;
}
