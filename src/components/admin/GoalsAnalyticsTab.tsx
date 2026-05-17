'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminEmptyDetail } from './shared';

type StationFilter = 'ALL' | 'TECH' | 'PACK';
type RangeFilter = 7 | 14 | 30;

interface GoalHistoryRow {
  staff_id: number;
  name: string;
  role: string;
  station: string;
  goal: number;
  actual: number;
  logged_date: string;
}

function getProgress(actual: number, goal: number) {
  const safeGoal = Math.max(1, goal);
  const progress = actual / safeGoal;
  return { progress, percent: Math.round(progress * 100) };
}

function getPerformanceTone(progress: number) {
  if (progress <= 0) return { label: 'Not Started', textClass: 'text-slate-400', barClass: 'bg-slate-300' };
  if (progress > 1) return { label: 'Above Goal', textClass: 'text-cyan-700', barClass: 'bg-cyan-600' };
  if (progress === 1) return { label: 'Hit Goal', textClass: 'text-emerald-700', barClass: 'bg-emerald-600' };
  if (progress >= 0.75) return { label: 'On the Way', textClass: 'text-blue-700', barClass: 'bg-blue-600' };
  if (progress >= 0.4) return { label: 'Making Progress', textClass: 'text-sky-700', barClass: 'bg-sky-600' };
  return { label: 'Getting Started', textClass: 'text-indigo-600', barClass: 'bg-indigo-500' };
}

const RANGE_OPTIONS: { value: RangeFilter; label: string }[] = [
  { value: 7, label: '7D' },
  { value: 14, label: '14D' },
  { value: 30, label: '30D' },
];

function formatShortDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function GoalsAnalyticsTab() {
  const searchParams = useSearchParams();
  const selectedStaffId = (() => {
    const raw = searchParams.get('staffId');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const queryClient = useQueryClient();
  const [stationFilter, setStationFilter] = useState<StationFilter>('ALL');
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>(14);

  const { data: historyRows = [], isLoading: loading } = useQuery<GoalHistoryRow[]>({
    queryKey: ['staff-goals-history', stationFilter, rangeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('days', String(rangeFilter));
      if (stationFilter !== 'ALL') params.set('station', stationFilter);
      const res = await fetch(`/api/staff-goals/history?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch history');
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  useEffect(() => {
    const handleRefresh = () => queryClient.invalidateQueries({ queryKey: ['staff-goals-history'] });
    window.addEventListener('admin-goals-refresh', handleRefresh as EventListener);
    return () => window.removeEventListener('admin-goals-refresh', handleRefresh as EventListener);
  }, [queryClient]);

  const staffSummary = useMemo(() => {
    if (selectedStaffId == null) return null;
    const rows = historyRows.filter((r) => r.staff_id === selectedStaffId);
    if (rows.length === 0) return null;
    const sorted = [...rows].sort((a, b) => b.logged_date.localeCompare(a.logged_date));
    const latest = sorted[0];
    const hitDays = sorted.filter((row) => row.actual >= row.goal).length;
    const aboveGoalDays = sorted.filter((row) => row.actual > row.goal).length;
    const averageActual = sorted.reduce((sum, row) => sum + row.actual, 0) / sorted.length;
    const averagePercent =
      sorted.reduce((sum, row) => sum + getProgress(row.actual, row.goal).percent, 0) / sorted.length;
    return {
      name: latest.name,
      role: latest.role,
      station: latest.station,
      latest,
      hitDays,
      aboveGoalDays,
      averageActual,
      averagePercent: Math.round(averagePercent),
      recent: sorted,
    };
  }, [historyRows, selectedStaffId]);

  if (selectedStaffId == null) {
    return (
      <AdminEmptyDetail
        title="Pick a staffer"
        hint="Select a staff member on the left to see their goal history, hit rate, and recent attainment."
      />
    );
  }

  if (loading) {
    return <AdminEmptyDetail title="Loading history…" />;
  }

  if (!staffSummary) {
    return (
      <AdminEmptyDetail
        title="No goal history yet"
        hint="This staffer hasn't recorded any goal snapshots in the selected range."
      />
    );
  }

  const latestMetrics = getProgress(staffSummary.latest.actual, staffSummary.latest.goal);
  const tone = getPerformanceTone(latestMetrics.progress);

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-6 py-4">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
            {staffSummary.role} · {staffSummary.station}
          </p>
          <h2 className="mt-0.5 truncate text-lg font-bold text-gray-900">{staffSummary.name}</h2>
        </div>
        <div className="flex items-center gap-1">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setRangeFilter(option.value)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition ${
                rangeFilter === option.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
              }`}
            >
              {option.label}
            </button>
          ))}
          <select
            value={stationFilter}
            onChange={(e) => setStationFilter(e.target.value as StationFilter)}
            className="ml-2 rounded-md border border-gray-300 px-2 py-1 text-[11px]"
          >
            <option value="ALL">All stations</option>
            <option value="TECH">Tech</option>
            <option value="PACK">Pack</option>
          </select>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <DetailCard
              label="Latest"
              value={
                <span className={tone.textClass}>
                  {staffSummary.latest.actual}/{staffSummary.latest.goal}
                </span>
              }
              hint={tone.label}
            />
            <DetailCard
              label="Hit days"
              value={`${staffSummary.hitDays}/${staffSummary.recent.length}`}
              hint={`${staffSummary.aboveGoalDays} above goal`}
            />
            <DetailCard
              label="Avg attainment"
              value={`${staffSummary.averagePercent}%`}
              hint={`${staffSummary.averageActual.toFixed(1)} avg actual`}
            />
            <DetailCard label="Last snapshot" value={formatShortDate(staffSummary.latest.logged_date)} />
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Trend</p>
            <div className="mt-3 flex items-end gap-2">
              {[...staffSummary.recent].reverse().map((entry) => {
                const metrics = getProgress(entry.actual, entry.goal);
                const height = Math.max(10, Math.min(64, Math.round(metrics.percent * 0.64)));
                const entryTone = getPerformanceTone(metrics.progress);
                return (
                  <div key={entry.logged_date} className="flex flex-col items-center gap-1">
                    <div className="flex h-16 items-end">
                      <div
                        className={`w-4 rounded-sm ${entryTone.barClass}`}
                        style={{ height: `${height}px` }}
                        title={`${entry.logged_date}: ${entry.actual}/${entry.goal}`}
                      />
                    </div>
                    <span className="text-[9px] font-medium text-gray-400">
                      {formatShortDate(entry.logged_date).split(' ')[1]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="grid grid-cols-[1fr_80px_80px_100px] gap-x-3 border-b border-gray-200 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-gray-500">
              <p>Date</p>
              <p className="text-right">Actual</p>
              <p className="text-right">Goal</p>
              <p className="text-right">Percent</p>
            </div>
            {staffSummary.recent.map((entry) => {
              const metrics = getProgress(entry.actual, entry.goal);
              const entryTone = getPerformanceTone(metrics.progress);
              return (
                <div
                  key={entry.logged_date}
                  className="grid grid-cols-[1fr_80px_80px_100px] gap-x-3 border-b border-gray-100 px-4 py-2.5 text-[12px] last:border-b-0"
                >
                  <p className="text-gray-700">{formatShortDate(entry.logged_date)}</p>
                  <p className="text-right tabular-nums text-gray-900">{entry.actual}</p>
                  <p className="text-right tabular-nums text-gray-900">{entry.goal}</p>
                  <p className={`text-right tabular-nums font-semibold ${entryTone.textClass}`}>
                    {metrics.percent}%
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function DetailCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{label}</p>
      <div className="mt-1 text-[15px] font-bold text-gray-900">{value}</div>
      {hint ? <p className="mt-0.5 text-[10px] text-gray-500">{hint}</p> : null}
    </div>
  );
}
