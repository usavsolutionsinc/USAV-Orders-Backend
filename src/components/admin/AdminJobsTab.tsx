'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mainStickyHeaderClass, mainStickyHeaderShellRowClass } from '@/components/layout/header-shell';

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

const STATE_COLORS: Record<string, string> = {
  DELIVERED: 'text-emerald-700 bg-emerald-50',
  ACTIVE: 'text-blue-700 bg-blue-50',
  CREATED: 'text-gray-600 bg-gray-100',
  IN_PROGRESS: 'text-blue-700 bg-blue-50',
  RETRY: 'text-amber-700 bg-amber-50',
  ERROR: 'text-red-700 bg-red-50',
  FAILED: 'text-red-700 bg-red-50',
  CANCELED: 'text-gray-500 bg-gray-100',
};

function formatTime(ts: number) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

function shortUrl(url: string) {
  try {
    const u = new URL(url);
    return u.pathname;
  } catch {
    return url;
  }
}

export function AdminJobsTab() {
  const [tab, setTab] = useState<'schedules' | 'logs'>('schedules');
  const [logFilter, setLogFilter] = useState('');

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

  const filteredLogs = useMemo(() => {
    if (!logFilter.trim()) return logs;
    const q = logFilter.toLowerCase();
    return logs.filter(
      (l) =>
        (l.label ?? '').toLowerCase().includes(q) ||
        l.url.toLowerCase().includes(q) ||
        l.state.toLowerCase().includes(q) ||
        (l.error ?? '').toLowerCase().includes(q),
    );
  }, [logs, logFilter]);

  const scheduleSummary = useMemo(() => {
    const total = schedules.length;
    const paused = schedules.filter((s) => s.isPaused).length;
    return { total, active: total - paused, paused };
  }, [schedules]);

  const logSummary = useMemo(() => {
    const delivered = logs.filter((l) => l.state === 'DELIVERED').length;
    const failed = logs.filter((l) => l.state === 'FAILED' || l.state === 'ERROR').length;
    const retrying = logs.filter((l) => l.state === 'RETRY').length;
    return { delivered, failed, retrying, total: logs.length };
  }, [logs]);

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-white">
      <div className={mainStickyHeaderClass}>
        <div className={`${mainStickyHeaderShellRowClass} flex-wrap gap-y-2 px-6`}>
          <div className="flex items-center gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-900">
              QStash Jobs
            </p>
            {query.isLoading ? (
              <span className="text-[11px] text-gray-400">Loading...</span>
            ) : (
              <span className="text-[11px] text-gray-500">
                {scheduleSummary.active} active schedules
                {logSummary.failed > 0 && (
                  <span className="ml-1.5 text-red-600">{logSummary.failed} failed</span>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab('schedules')}
              className={`h-8 border px-3 text-xs font-semibold ${
                tab === 'schedules'
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-300 text-gray-700'
              }`}
            >
              Schedules ({scheduleSummary.total})
            </button>
            <button
              type="button"
              onClick={() => setTab('logs')}
              className={`h-8 border px-3 text-xs font-semibold ${
                tab === 'logs'
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-300 text-gray-700'
              }`}
            >
              Logs ({logSummary.total})
            </button>
            <button
              type="button"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
              className="h-8 border border-gray-300 px-3 text-xs text-gray-700 disabled:opacity-50"
            >
              {query.isFetching ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-6 py-5">
        {tab === 'schedules' ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden border border-gray-200">
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="min-w-[900px]">
                <div className="grid grid-cols-[1fr_120px_64px_64px_80px] gap-x-3 border-b border-gray-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                  <p>Destination</p>
                  <p>Cron</p>
                  <p>Retries</p>
                  <p>Method</p>
                  <p>Status</p>
                </div>

                {schedules.length === 0 ? (
                  <div className="px-4 py-6 text-xs text-gray-500">
                    {query.isLoading ? 'Loading schedules...' : 'No schedules found.'}
                  </div>
                ) : (
                  schedules.map((s) => (
                    <div
                      key={s.scheduleId}
                      className="grid grid-cols-[1fr_120px_64px_64px_80px] gap-x-3 border-b border-gray-100 px-4 py-3 text-[11px] text-gray-700"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{shortUrl(s.destination)}</p>
                        <p className="truncate text-[10px] text-gray-400">{s.scheduleId}</p>
                      </div>
                      <p className="font-mono text-[10px]">{s.cron}</p>
                      <p>{s.retries}</p>
                      <p>{s.method}</p>
                      <p>
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                            s.isPaused ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {s.isPaused ? 'Paused' : 'Active'}
                        </span>
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col overflow-hidden border border-gray-200">
            <div className="border-b border-gray-200 px-4 py-2">
              <input
                value={logFilter}
                onChange={(e) => setLogFilter(e.target.value)}
                placeholder="Filter by label, url, state, or error..."
                className="h-8 w-full max-w-[400px] border border-gray-300 px-2 text-xs"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="min-w-[900px]">
                <div className="grid grid-cols-[160px_80px_1fr_120px_1fr] gap-x-3 border-b border-gray-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                  <p>Time</p>
                  <p>State</p>
                  <p>URL</p>
                  <p>Label</p>
                  <p>Error</p>
                </div>

                {filteredLogs.length === 0 ? (
                  <div className="px-4 py-6 text-xs text-gray-500">
                    {query.isLoading ? 'Loading logs...' : 'No logs found.'}
                  </div>
                ) : (
                  filteredLogs.map((l, i) => (
                    <div
                      key={`${l.messageId}-${l.time}-${i}`}
                      className="grid grid-cols-[160px_80px_1fr_120px_1fr] gap-x-3 border-b border-gray-100 px-4 py-3 text-[11px] text-gray-700"
                    >
                      <p className="tabular-nums">{formatTime(l.time)}</p>
                      <p>
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                            STATE_COLORS[l.state] ?? 'text-gray-600 bg-gray-100'
                          }`}
                        >
                          {l.state}
                        </span>
                      </p>
                      <p className="truncate">{shortUrl(l.url)}</p>
                      <p className="truncate text-gray-500">{l.label || '-'}</p>
                      <p className="truncate text-red-600">{l.error || '-'}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2">
              <p className="text-xs text-gray-500">
                {logSummary.delivered} delivered, {logSummary.failed} failed, {logSummary.retrying} retrying
              </p>
              <p className="text-xs text-gray-500">
                Showing {filteredLogs.length} of {logs.length} logs
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
