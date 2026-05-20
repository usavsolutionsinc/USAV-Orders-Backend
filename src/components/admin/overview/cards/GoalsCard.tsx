'use client';

import { useEffect, useState } from 'react';
import { BarChart3 } from '@/components/Icons';
import { StatusCard } from '../StatusCard';

interface GoalRow {
  staff_id: number;
  name?: string;
  daily_goal: number;
  actual?: number;
  station?: string;
}

export function GoalsCard() {
  const [data, setData] = useState<GoalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/staff-goals', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Goals ${r.status}`))))
      .then((rows: GoalRow[] | { rows?: GoalRow[] }) => {
        const list = Array.isArray(rows) ? rows : rows.rows ?? [];
        setData(list);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const onTrack = (data ?? []).filter((r) => (r.actual ?? 0) >= r.daily_goal).length;
  const behind = (data ?? []).filter(
    (r) => (r.actual ?? 0) < r.daily_goal * 0.5 && r.daily_goal > 0,
  ).length;

  return (
    <StatusCard
      icon={BarChart3}
      title="Today's goals"
      loading={loading}
      error={error}
      primary={onTrack}
      secondary={data ? `${onTrack} on track · ${behind} below 50%` : undefined}
      tertiary={data ? `${data.length} staff tracked` : undefined}
      tone={behind > 0 ? 'warn' : 'good'}
      href="/admin?section=goals"
    />
  );
}
