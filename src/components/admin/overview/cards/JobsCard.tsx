'use client';

import { useEffect, useState } from 'react';
import { Calendar } from '@/components/Icons';
import { StatusCard } from '../StatusCard';

interface QStashLog {
  time: number | string;
  state?: string;
  label?: string | null;
  error?: string | null;
}

interface QStashStatus {
  schedules?: Array<{ scheduleId: string; cron: string }>;
  logs?: QStashLog[];
}

function timeAgo(input: number | string): string {
  const ms = typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(ms)) return '—';
  const delta = Date.now() - ms;
  const min = Math.round(delta / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

export function JobsCard() {
  const [data, setData] = useState<QStashStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/qstash-status', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Jobs ${r.status}`))))
      .then((d: QStashStatus) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const recent = data?.logs?.[0];
  const recentFailures = (data?.logs ?? []).filter((l) => l.state === 'failed' || l.error).length;

  return (
    <StatusCard
      icon={Calendar}
      title="Background jobs"
      loading={loading}
      error={error}
      primary={data?.schedules?.length ?? 0}
      secondary={recent ? `Last run: ${timeAgo(recent.time)}${recent.label ? ` · ${recent.label}` : ''}` : 'No recent runs'}
      tertiary={recentFailures > 0 ? `${recentFailures} failure${recentFailures === 1 ? '' : 's'} in last 200` : 'All recent runs OK'}
      tone={recentFailures > 0 ? 'warn' : 'good'}
      href="/admin?section=jobs"
    />
  );
}
