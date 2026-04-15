'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStationChannelName } from '@/lib/realtime/channels';
import { useAblyChannel } from '@/hooks/useAblyChannel';

type ActivityEntry = {
  id: number;
  station: string;
  activity_type: string;
  staff_id: number | null;
  staff_name: string | null;
  scan_ref: string | null;
  fnsku: string | null;
  shipment_id: number | null;
  notes: string | null;
  created_at: string;
  delta?: number | null;
  dimension?: string | null;
  reason?: string | null;
};

const STATION_COLORS: Record<string, string> = {
  TECH: 'bg-emerald-500',
  PACK: 'bg-blue-500',
  RECEIVING: 'bg-amber-500',
  ADMIN: 'bg-gray-500',
};

const ACTIVITY_LABELS: Record<string, string> = {
  TRACKING_SCANNED: 'Tech Scan',
  SERIAL_ADDED: 'Serial Added',
  PACK_COMPLETED: 'Pack Complete',
  PACK_SCAN: 'Pack Scan',
  FNSKU_SCANNED: 'FNSKU Scanned',
  FBA_READY: 'FBA Ready',
  WS_ORDER_TESTED: 'WS Order Tested',
  WS_REPAIR_CHANGED: 'WS Repair Changed',
  WS_RECEIVING_CHANGED: 'WS Receiving Changed',
  WS_FBA_SCAN: 'WS FBA Scan',
  STOCK_DELTA_PICKED: 'Stock Decreased',
  STOCK_DELTA_PACKED: 'Boxed Stock Increased',
  STOCK_DELTA_SHIPPED: 'Boxed Stock Decreased',
  STOCK_DELTA_RECEIVED: 'Stock Received',
  STOCK_DELTA_RETURNED: 'Stock Returned',
  STOCK_DELTA_ADJUSTMENT: 'Stock Adjusted',
  STOCK_DELTA_SET: 'Stock Set',
  STOCK_DELTA_CYCLE_COUNT: 'Cycle Count',
  STOCK_DELTA_DAMAGED: 'Marked Damaged',
  STOCK_DELTA_SOLD: 'Sold',
};

function formatLedgerNote(entry: ActivityEntry): string | null {
  if (entry.delta == null || !entry.reason) return entry.notes;
  const qty = Math.abs(entry.delta);
  const unit = qty === 1 ? 'unit' : 'units';
  const who = entry.staff_name ? `${entry.staff_name} ` : '';
  switch (entry.reason) {
    case 'PICKED':
      return `${who}decreased stock by ${qty} ${unit}`;
    case 'PACKED':
      return `${who}increased boxed stock by ${qty} ${unit}`;
    case 'SHIPPED':
      return `${who}shipped ${qty} boxed ${unit}`;
    case 'RECEIVED':
      return `${who}received ${qty} ${unit} into stock`;
    case 'RETURNED':
      return `${who}returned ${qty} ${unit} to stock`;
    case 'ADJUSTMENT':
    case 'SET':
    case 'CYCLE_COUNT':
      return `${who}${entry.delta > 0 ? 'added' : 'removed'} ${qty} ${unit}`;
    default:
      return entry.notes;
  }
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

export function ActivityFeed({ maxItems = 50 }: { maxItems?: number }) {
  const { data } = useQuery({
    queryKey: ['activity-feed'],
    queryFn: async () => {
      const res = await fetch(`/api/activity/feed?limit=${maxItems}`);
      if (!res.ok) throw new Error('Failed to fetch activity feed');
      const json = await res.json();
      return (json.activities ?? []) as ActivityEntry[];
    },
    refetchInterval: 120_000,
    staleTime: 30_000,
  });

  const [liveEvents, setLiveEvents] = useState<ActivityEntry[]>([]);

  useAblyChannel(
    getStationChannelName(),
    'activity.logged',
    (message: any) => {
      const d = message?.data;
      if (!d?.id) return;
      const entry: ActivityEntry = {
        id: Number(d.id),
        station: d.station ?? '',
        activity_type: d.activityType ?? '',
        staff_id: d.staffId ?? null,
        staff_name: d.staffName ?? null,
        scan_ref: d.scanRef ?? null,
        fnsku: d.fnsku ?? null,
        shipment_id: null,
        notes: null,
        created_at: d.timestamp ?? new Date().toISOString(),
        delta: d.delta ?? null,
        dimension: d.dimension ?? null,
        reason: d.reason ?? null,
      };
      setLiveEvents((prev) => [entry, ...prev].slice(0, maxItems));
    },
    true,
  );

  const combined = useMemo(() => {
    const fetched = data ?? [];
    const all = [...liveEvents, ...fetched];
    const seen = new Set<number>();
    return all.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    }).slice(0, maxItems);
  }, [liveEvents, data, maxItems]);

  if (combined.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-gray-400">
        No recent activity
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 overflow-y-auto">
      {combined.map((entry) => {
        const isLedger = entry.activity_type?.startsWith('STOCK_DELTA_');
        const ledgerNote = isLedger ? formatLedgerNote(entry) : null;
        const deltaSign = entry.delta != null ? (entry.delta > 0 ? '+' : entry.delta < 0 ? '−' : '') : '';
        const deltaClass =
          entry.delta != null && entry.delta > 0
            ? 'text-emerald-600'
            : entry.delta != null && entry.delta < 0
              ? 'text-rose-600'
              : 'text-gray-500';
        return (
          <div
            key={entry.id}
            className="flex items-start gap-2 rounded px-2 py-1.5 text-xs hover:bg-gray-50"
          >
            <span
              className={`mt-1 h-2 w-2 shrink-0 rounded-full ${STATION_COLORS[entry.station] ?? 'bg-gray-400'}`}
              title={entry.station}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="font-medium text-gray-700">
                  {ACTIVITY_LABELS[entry.activity_type] ?? entry.activity_type}
                </span>
                {entry.staff_name && (
                  <span className="text-gray-500">{entry.staff_name}</span>
                )}
                {isLedger && entry.delta != null && (
                  <span className={`font-semibold tabular-nums ${deltaClass}`}>
                    {deltaSign}
                    {Math.abs(entry.delta)}
                  </span>
                )}
              </div>
              {isLedger ? (
                ledgerNote && <div className="truncate text-gray-500">{ledgerNote}</div>
              ) : (
                (entry.scan_ref || entry.fnsku) && (
                  <div className="truncate text-gray-400">{entry.scan_ref || entry.fnsku}</div>
                )
              )}
              {isLedger && entry.scan_ref && (
                <div className="truncate text-[10px] text-gray-400">SKU {entry.scan_ref}</div>
              )}
            </div>
            <span className="shrink-0 text-gray-400">{formatTime(entry.created_at)}</span>
          </div>
        );
      })}
    </div>
  );
}
