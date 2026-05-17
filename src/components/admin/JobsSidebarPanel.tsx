'use client';

/**
 * Sidebar for /admin?section=jobs — picker for QStash schedules + delivery logs.
 *
 * URL-state contract:
 *   ?search=<q>              — search box value (filters whichever list is active)
 *   ?jobsTab=schedules|logs  — which list is visible (default: schedules)
 *   ?scheduleId=<id>         — selected schedule (read by main pane)
 *   ?messageId=<id>          — selected delivery (read by main pane)
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SearchBar } from '@/components/ui/SearchBar';
import {
  AdminSidebarShell,
  AdminFilterChips,
  AdminPickerRow,
  StatPill,
  useAdminUrlState,
} from './shared';

type ScheduleRow = {
  scheduleId: string;
  cron: string;
  destination: string;
  method: string;
  retries: number;
  isPaused: boolean;
  createdAt: number;
};

type LogRow = {
  time: number;
  state: string;
  messageId: string;
  url: string;
  label: string | null;
  error: string | null;
};

type JobsTab = 'schedules' | 'logs';

const TAB_OPTIONS = [
  { value: 'schedules' as JobsTab, label: 'Schedules' },
  { value: 'logs' as JobsTab, label: 'Logs' },
];

const STATE_DOT: Record<string, string> = {
  DELIVERED: 'bg-emerald-500',
  ACTIVE: 'bg-blue-500',
  CREATED: 'bg-gray-400',
  IN_PROGRESS: 'bg-blue-500',
  RETRY: 'bg-amber-500',
  ERROR: 'bg-red-500',
  FAILED: 'bg-red-500',
  CANCELED: 'bg-gray-400',
};

function shortUrl(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function formatTime(ts: number) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

export function JobsSidebarPanel() {
  const { searchParams, setParam } = useAdminUrlState();
  const search = searchParams.get('search') ?? '';
  const tab = (searchParams.get('jobsTab') as JobsTab) || 'schedules';
  const selectedScheduleId = searchParams.get('scheduleId') ?? '';
  const selectedMessageId = searchParams.get('messageId') ?? '';

  const query = useQuery({
    queryKey: ['admin-qstash-status'],
    queryFn: async () => {
      const res = await fetch('/api/admin/qstash-status', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load QStash status');
      return {
        schedules: (data.schedules ?? []) as ScheduleRow[],
        logs: (data.logs ?? []) as LogRow[],
      };
    },
    refetchInterval: 30_000,
  });

  const schedules = query.data?.schedules ?? [];
  const logs = query.data?.logs ?? [];

  const stats = useMemo(() => {
    const active = schedules.filter((s) => !s.isPaused).length;
    const paused = schedules.filter((s) => s.isPaused).length;
    const failed = logs.filter((l) => l.state === 'FAILED' || l.state === 'ERROR').length;
    const retrying = logs.filter((l) => l.state === 'RETRY').length;
    return { active, paused, failed, retrying };
  }, [schedules, logs]);

  const filteredSchedules = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return schedules;
    return schedules.filter(
      (s) =>
        s.destination.toLowerCase().includes(q) ||
        s.cron.toLowerCase().includes(q) ||
        s.scheduleId.toLowerCase().includes(q),
    );
  }, [schedules, search]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) =>
        (l.label ?? '').toLowerCase().includes(q) ||
        l.url.toLowerCase().includes(q) ||
        l.state.toLowerCase().includes(q) ||
        (l.error ?? '').toLowerCase().includes(q),
    );
  }, [logs, search]);

  return (
    <AdminSidebarShell
      search={
        <SearchBar
          value={search}
          onChange={(v) =>
            setParam((p) => {
              if (v.trim()) p.set('search', v.trim());
              else p.delete('search');
            })
          }
          onClear={() => setParam((p) => p.delete('search'))}
          placeholder={tab === 'schedules' ? 'Search schedules' : 'Search logs'}
          variant="blue"
          className="w-full"
        />
      }
      filters={
        <AdminFilterChips
          options={TAB_OPTIONS}
          value={tab}
          onChange={(next) =>
            setParam((p) => {
              if (next === 'schedules') p.delete('jobsTab');
              else p.set('jobsTab', next);
              p.delete('scheduleId');
              p.delete('messageId');
            })
          }
        />
      }
      stats={
        <>
          <StatPill label="Active" value={stats.active} tone="green" />
          <StatPill label="Paused" value={stats.paused} />
          {stats.failed > 0 ? <StatPill label="Failed" value={stats.failed} tone="purple" /> : null}
          {stats.retrying > 0 ? <StatPill label="Retry" value={stats.retrying} tone="blue" /> : null}
        </>
      }
      action={
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
        >
          {query.isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      }
    >
      {query.isLoading ? (
        <div className="px-2 py-6 text-center text-xs text-gray-400">Loading…</div>
      ) : tab === 'schedules' ? (
        filteredSchedules.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-gray-400">No schedules.</div>
        ) : (
          <ul className="space-y-1.5">
            {filteredSchedules.map((s) => (
              <li key={s.scheduleId}>
                <AdminPickerRow
                  selected={selectedScheduleId === s.scheduleId}
                  onPick={() => setParam((p) => p.set('scheduleId', s.scheduleId))}
                  title={shortUrl(s.destination)}
                  subtitle={`${s.cron} · ${s.method}`}
                  trailing={
                    <span
                      title={s.isPaused ? 'Paused' : 'Active'}
                      className={`h-2 w-2 rounded-full ${
                        s.isPaused ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                    />
                  }
                />
              </li>
            ))}
          </ul>
        )
      ) : filteredLogs.length === 0 ? (
        <div className="px-2 py-6 text-center text-xs text-gray-400">No logs.</div>
      ) : (
        <ul className="space-y-1.5">
          {filteredLogs.map((l, i) => (
            <li key={`${l.messageId}-${l.time}-${i}`}>
              <AdminPickerRow
                selected={selectedMessageId === l.messageId}
                onPick={() => setParam((p) => p.set('messageId', l.messageId))}
                title={l.label || shortUrl(l.url)}
                subtitle={formatTime(l.time)}
                trailing={
                  <span
                    title={l.state}
                    className={`h-2 w-2 rounded-full ${STATE_DOT[l.state] ?? 'bg-gray-400'}`}
                  />
                }
              />
            </li>
          ))}
        </ul>
      )}
    </AdminSidebarShell>
  );
}
