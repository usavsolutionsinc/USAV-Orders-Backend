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
};

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
      {combined.map((entry) => (
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
                <span className="text-gray-500">
                  {entry.staff_name}
                </span>
              )}
            </div>
            {(entry.scan_ref || entry.fnsku) && (
              <div className="truncate text-gray-400">
                {entry.scan_ref || entry.fnsku}
              </div>
            )}
          </div>
          <span className="shrink-0 text-gray-400">
            {formatTime(entry.created_at)}
          </span>
        </div>
      ))}
    </div>
  );
}
