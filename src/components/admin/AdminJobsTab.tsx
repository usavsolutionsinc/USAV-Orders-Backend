'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AdminEmptyDetail } from './shared';

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

export function AdminJobsTab() {
  const searchParams = useSearchParams();
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

  const selectedSchedule = useMemo(
    () => query.data?.schedules.find((s) => s.scheduleId === selectedScheduleId) ?? null,
    [query.data, selectedScheduleId],
  );

  const selectedLog = useMemo(
    () => query.data?.logs.find((l) => l.messageId === selectedMessageId) ?? null,
    [query.data, selectedMessageId],
  );

  if (query.isLoading) {
    return <AdminEmptyDetail title="Loading jobs…" />;
  }

  if (tab === 'schedules' && !selectedSchedule) {
    return (
      <AdminEmptyDetail
        title="Pick a schedule"
        hint="Select a QStash schedule from the left to see its details and run history."
      />
    );
  }

  if (tab === 'logs' && !selectedLog) {
    return (
      <AdminEmptyDetail
        title="Pick a delivery"
        hint="Select a delivery log from the left to see its full payload, headers, and error."
      />
    );
  }

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-gray-50">
      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        {tab === 'schedules' && selectedSchedule ? (
          <ScheduleDetail row={selectedSchedule} />
        ) : tab === 'logs' && selectedLog ? (
          <LogDetail row={selectedLog} />
        ) : null}
      </div>
    </section>
  );
}

function ScheduleDetail({ row }: { row: ScheduleRow }) {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-micro font-bold uppercase tracking-widest text-gray-500">Schedule</p>
          <h2 className="mt-0.5 break-all text-lg font-bold text-gray-900">
            {row.destination}
          </h2>
          <p className="mt-0.5 break-all font-mono text-caption text-gray-400">{row.scheduleId}</p>
        </div>
        <span
          className={`inline-flex flex-shrink-0 rounded-full px-2.5 py-1 text-micro font-bold uppercase tracking-wider ${
            row.isPaused ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {row.isPaused ? 'Paused' : 'Active'}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <DetailCard label="Cron" value={<span className="font-mono">{row.cron}</span>} />
        <DetailCard label="Method" value={row.method} />
        <DetailCard label="Retries" value={row.retries} />
        <DetailCard label="Created" value={formatTime(row.createdAt)} />
      </div>
    </div>
  );
}

function LogDetail({ row }: { row: LogRow }) {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-micro font-bold uppercase tracking-widest text-gray-500">Delivery</p>
          <h2 className="mt-0.5 break-all text-lg font-bold text-gray-900">
            {row.label || row.url}
          </h2>
          <p className="mt-0.5 break-all font-mono text-caption text-gray-400">{row.messageId}</p>
        </div>
        <span
          className={`inline-flex flex-shrink-0 rounded-full px-2.5 py-1 text-micro font-bold uppercase tracking-wider ${
            STATE_COLORS[row.state] ?? 'bg-gray-100 text-gray-600'
          }`}
        >
          {row.state}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <DetailCard label="Time" value={formatTime(row.time)} />
        <DetailCard label="URL" value={<span className="break-all font-mono text-caption">{row.url}</span>} />
      </div>

      {row.error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-micro font-bold uppercase tracking-widest text-red-700">Error</p>
          <pre className="mt-2 whitespace-pre-wrap break-words text-label text-red-800">
            {row.error}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function DetailCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-micro font-bold uppercase tracking-widest text-gray-500">{label}</p>
      <div className="mt-1 break-words text-sm font-semibold text-gray-900">{value}</div>
    </div>
  );
}
