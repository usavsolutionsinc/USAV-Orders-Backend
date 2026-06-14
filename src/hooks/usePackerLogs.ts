'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getStationChannelName, safeChannelName } from '@/lib/realtime/channels';
import { useAblyChannel } from './useAblyChannel';
import { useAuth } from '@/contexts/AuthContext';

export interface PackerRecord {
  id: number;
  /** `packer_logs.id` when present; DELETE uses this (not station_activity_logs.id). */
  packer_log_id?: number | null;
  created_at: string;
  scan_ref: string | null;
  shipping_tracking_number: string;
  tracking_numbers?: string[] | null;
  tracking_number_rows?: Array<{
    shipment_id: number | null;
    tracking: string;
    is_primary: boolean;
  }> | null;
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
  fnsku?: string | null;
  fnsku_log_id?: number | null;
  /** Matched `sku.id` when serial was resolved from the `sku` table (SKU pack scan_ref). */
  sku_table_id?: number | null;
  /** 'exception' when sal.orders_exception_id resolved but no order matched; else 'order'. */
  row_source?: 'order' | 'exception' | string | null;
  orders_exception_id?: number | null;
  exception_reason?: string | null;
  exception_status?: string | null;
  /** Carrier columns sourced from `shipping_tracking_numbers stn` via sal.shipment_id. */
  carrier?: string | null;
  latest_status_code?: string | null;
  latest_status_label?: string | null;
  latest_status_description?: string | null;
  latest_status_category?: string | null;
  latest_event_at?: string | null;
  has_exception?: boolean | null;
  exception_at?: string | null;
  is_terminal?: boolean | null;
  /** Dock scan-out (station_activity_logs SHIP_CONFIRM) — when the package left the warehouse. */
  ship_confirmed_at?: string | null;
  shipped_out_by?: number | null;
  shipped_out_by_name?: string | null;
}

export interface UsePackerLogsOptions {
  weekOffset?: number;
  weekRange?: { startStr: string; endStr: string };
}

/** Compute PST Sun–Sat range for the current week (matches computeWeekRange + API cache key). */
function computeCurrentPSTWeek(): { startStr: string; endStr: string } {
  const d = new Date();
  const pstMs = d.getTime() - 7 * 60 * 60 * 1000;
  const pst = new Date(pstMs);
  const daysFromSunday = pst.getUTCDay();
  const sun = new Date(pstMs - daysFromSunday * 86400000);
  const sat = new Date(pstMs + (6 - daysFromSunday) * 86400000);
  const fmt = (x: Date) =>
    `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
  return { startStr: fmt(sun), endStr: fmt(sat) };
}

export function usePackerLogs(packerId: number, options: UsePackerLogsOptions = {}) {
  const { weekOffset = 0, weekRange } = options;
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId;
  // Global per-org station broadcast (packer logs are filtered by packerId in
  // the handler) — NOT a per-staff bridge.
  const stationChannel = safeChannelName(() => getStationChannelName(orgId!));
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
      // API sets Cache-Control max-age; without no-store, refetches after DELETE can
      // return a stale browser-cached body and the table won't update until cache expires.
      const res = await fetch(`/api/packerlogs?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch packer logs');
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: weekOffset === 0 ? 2 * 60 * 1000 : 30 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // ── Ably: live row-level updates from any session (mobile or web) ─────────
  useAblyChannel(
    stationChannel,
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
    !!stationChannel,
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
