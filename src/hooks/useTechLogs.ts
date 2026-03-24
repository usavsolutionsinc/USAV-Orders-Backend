'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
      const res = await fetch(`/api/tech-logs?${params}`);
      if (!res.ok) throw new Error('Failed to fetch tech logs');
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    // Current week stays fresh for 2 min; historical weeks cache for 30 min.
    staleTime: weekOffset === 0 ? 2 * 60 * 1000 : 30 * 60 * 1000,
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
        // Surgical prepend — no refetch needed for a known new row.
        const currentWeek = computeCurrentPSTWeek();
        queryClient.setQueryData<TechRecord[]>(
          ['tech-logs', techId, { weekStart: currentWeek.startStr, weekEnd: currentWeek.endStr }],
          (prev) => {
            if (!prev) return undefined;
            if (prev.some((r) => r.id === (row as TechRecord).id)) return prev;
            return [row as TechRecord, ...prev];
          },
        );
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
      if (!record?.id || record.tested_by !== techId) return;

      const currentWeek = computeCurrentPSTWeek();
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

  return query;
}
