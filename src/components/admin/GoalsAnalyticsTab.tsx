'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { mainStickyHeaderClass, mainStickyHeaderShellRowClass } from '@/components/layout/header-shell';

type GoalViewMode = 'all' | 'behind' | 'on-track' | 'exceeded';
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

interface StaffHistorySummary {
  key: string;
  staffId: number;
  name: string;
  role: string;
  station: string;
  latestGoal: number;
  latestActual: number;
  latestDate: string;
  latestProgress: number;
  latestPercent: number;
  hitDays: number;
  aboveGoalDays: number;
  averageActual: number;
  averagePercent: number;
  recentEntries: GoalHistoryRow[];
}

function parseGoalView(value: string | null): GoalViewMode {
  if (value === 'behind' || value === 'on-track' || value === 'exceeded') return value;
  return 'all';
}

function getProgress(actual: number, goal: number) {
  const safeGoal = Math.max(1, goal);
  const progress = actual / safeGoal;
  return {
    progress,
    percent: Math.round(progress * 100),
  };
}

function getPerformanceTone(progress: number) {
  if (progress <= 0) {
    return {
      label: 'Not Started',
      textClass: 'text-slate-400',
      barClass: 'bg-slate-300',
    };
  }

  if (progress > 1) {
    return {
      label: 'Above Goal',
      textClass: 'text-cyan-700',
      barClass: 'bg-cyan-600',
    };
  }

  if (progress === 1) {
    return {
      label: 'Hit Goal',
      textClass: 'text-emerald-700',
      barClass: 'bg-emerald-600',
    };
  }

  if (progress >= 0.75) {
    return {
      label: 'On the Way',
      textClass: 'text-blue-700',
      barClass: 'bg-blue-600',
    };
  }

  if (progress >= 0.4) {
    return {
      label: 'Making Progress',
      textClass: 'text-sky-700',
      barClass: 'bg-sky-600',
    };
  }

  return {
    label: 'Getting Started',
    textClass: 'text-indigo-600',
    barClass: 'bg-indigo-500',
  };
}

function matchesView(progress: number, goalView: GoalViewMode) {
  if (goalView === 'behind') return progress < 0.7;
  if (goalView === 'on-track') return progress >= 0.7 && progress < 1;
  if (goalView === 'exceeded') return progress >= 1;
  return true;
}

const STATION_TABS: { value: StationFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'TECH', label: 'Tech' },
  { value: 'PACK', label: 'Pack' },
];

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
  const searchTerm = (searchParams.get('search') || '').trim().toLowerCase();
  const goalView = parseGoalView(searchParams.get('goalView'));

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

  const groupedRows = useMemo(() => {
    const groups = new Map<string, GoalHistoryRow[]>();

    for (const row of historyRows) {
      const key = `${row.staff_id}:${row.station}`;
      const current = groups.get(key);
      if (current) current.push(row);
      else groups.set(key, [row]);
    }

    const summaries: StaffHistorySummary[] = [];

    for (const [key, rows] of groups.entries()) {
      const sorted = [...rows].sort((a, b) => b.logged_date.localeCompare(a.logged_date));
      const latest = sorted[0];
      const latestMetrics = getProgress(latest.actual, latest.goal);
      const hitDays = sorted.filter((row) => row.actual >= row.goal).length;
      const aboveGoalDays = sorted.filter((row) => row.actual > row.goal).length;
      const averageActual = sorted.reduce((sum, row) => sum + row.actual, 0) / sorted.length;
      const averagePercent = sorted.reduce((sum, row) => sum + getProgress(row.actual, row.goal).percent, 0) / sorted.length;

      summaries.push({
        key,
        staffId: latest.staff_id,
        name: latest.name,
        role: latest.role,
        station: latest.station,
        latestGoal: latest.goal,
        latestActual: latest.actual,
        latestDate: latest.logged_date,
        latestProgress: latestMetrics.progress,
        latestPercent: latestMetrics.percent,
        hitDays,
        aboveGoalDays,
        averageActual,
        averagePercent,
        recentEntries: sorted,
      });
    }

    return summaries;
  }, [historyRows]);

  const filteredStaffHistory = useMemo(() => {
    return groupedRows
      .filter((row) => {
        const matchesSearch =
          !searchTerm ||
          row.name.toLowerCase().includes(searchTerm) ||
          row.role.toLowerCase().includes(searchTerm);
        return matchesSearch && matchesView(row.latestProgress, goalView);
      })
      .sort((a, b) => b.latestPercent - a.latestPercent || a.name.localeCompare(b.name));
  }, [goalView, groupedRows, searchTerm]);

  const summary = useMemo(() => {
    const snapshotRows = filteredStaffHistory.flatMap((row) => row.recentEntries);
    const latestDate = snapshotRows.reduce<string | null>((max, row) => {
      if (!max || row.logged_date > max) return row.logged_date;
      return max;
    }, null);

    const latestRows = latestDate
      ? filteredStaffHistory.filter((row) => row.latestDate === latestDate)
      : [];

    const averageAttainment = filteredStaffHistory.length > 0
      ? Math.round(
          filteredStaffHistory.reduce((sum, row) => sum + row.averagePercent, 0) / filteredStaffHistory.length,
        )
      : 0;

    return {
      staffCount: filteredStaffHistory.length,
      snapshotCount: snapshotRows.length,
      latestDate,
      goalHitsOnLatestDay: latestRows.filter((row) => row.latestActual >= row.latestGoal).length,
      averageAttainment,
    };
  }, [filteredStaffHistory]);

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-white">
      <div className={mainStickyHeaderClass}>
        <div className={`${mainStickyHeaderShellRowClass} flex-wrap gap-y-2 px-6`}>
          <div className="flex items-center gap-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-900">KPI History</p>
            <div className="flex items-center gap-1">
              {STATION_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setStationFilter(tab.value)}
                  className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                    stationFilter === tab.value
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setRangeFilter(option.value)}
                  className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                    rangeFilter === option.value
                      ? 'bg-blue-600 text-white'
                      : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
            <span>{summary.staffCount} staff in history</span>
            <span>{summary.snapshotCount} snapshots</span>
            <span>{summary.averageAttainment}% average attainment</span>
            <span>
              {summary.latestDate
                ? `${summary.goalHitsOnLatestDay} at goal on ${formatShortDate(summary.latestDate)}`
                : 'Waiting for daily snapshots'}
            </span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {loading ? (
          <div className="flex h-full items-center justify-center rounded-sm border border-gray-200 px-6 py-10 text-xs text-gray-500">
            Loading KPI history...
          </div>
        ) : filteredStaffHistory.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-gray-300 px-6 py-10 text-center text-xs text-gray-500">
            No KPI history matches this search or filter yet.
          </div>
        ) : (
          <div className="space-y-4">
            {summary.latestDate && (
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-sm border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Latest Snapshot</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900">{formatShortDate(summary.latestDate)}</p>
                </div>
                <div className="rounded-sm border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">At Or Above Goal</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900">{summary.goalHitsOnLatestDay}</p>
                </div>
                <div className="rounded-sm border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">Average Attainment</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900">{summary.averageAttainment}%</p>
                </div>
              </div>
            )}

            <div className="overflow-hidden rounded-sm border border-gray-200">
              <div className="grid grid-cols-[minmax(200px,1.4fr)_76px_110px_110px_120px_minmax(180px,1fr)] gap-x-3 border-b border-gray-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                <p>Staff</p>
                <p>Station</p>
                <p>Latest</p>
                <p>Hit Days</p>
                <p>Avg Attainment</p>
                <p>Trend</p>
              </div>

              {filteredStaffHistory.map((row) => {
                const tone = getPerformanceTone(row.latestProgress);
                const recentTrend = row.recentEntries.slice(0, Math.min(rangeFilter, 10)).reverse();

                return (
                  <div
                    key={row.key}
                    className="grid grid-cols-[minmax(200px,1.4fr)_76px_110px_110px_120px_minmax(180px,1fr)] gap-x-3 border-b border-gray-200 px-4 py-3 text-sm last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-gray-900">{row.name}</p>
                      <p className="truncate text-xs text-gray-500">
                        {row.role} • Updated {formatShortDate(row.latestDate)}
                      </p>
                    </div>

                    <div className="min-w-0">
                      <span className={`inline-block px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${
                        row.station === 'PACK'
                          ? 'bg-violet-50 text-violet-700'
                          : 'bg-blue-50 text-blue-700'
                      }`}>
                        {row.station}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <p className={`text-sm font-semibold ${tone.textClass}`}>{tone.label}</p>
                      <p className="text-xs text-gray-500">
                        {row.latestActual}/{row.latestGoal}
                      </p>
                    </div>

                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">
                        {row.hitDays}/{row.recentEntries.length}
                      </p>
                      <p className="text-xs text-gray-500">{row.aboveGoalDays} above goal</p>
                    </div>

                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{Math.round(row.averagePercent)}%</p>
                      <p className="text-xs text-gray-500">{row.averageActual.toFixed(1)} avg actual</p>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-end gap-1">
                        {recentTrend.map((entry) => {
                          const metrics = getProgress(entry.actual, entry.goal);
                          const height = Math.max(10, Math.min(44, Math.round(metrics.percent * 0.44)));
                          const entryTone = getPerformanceTone(metrics.progress);

                          return (
                            <div key={`${row.key}-${entry.logged_date}`} className="flex flex-col items-center gap-1">
                              <div className="flex h-11 items-end">
                                <div
                                  className={`w-3 rounded-sm ${entryTone.barClass}`}
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
                  </div>
                );
              })}
            </div>

            {historyRows.length > 0 && historyRows.every((row) => row.logged_date === historyRows[0].logged_date) && (
              <div className="rounded-sm border border-dashed border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
                KPI history currently has one snapshot day loaded. The nightly `staff_goal_history` job will make this trend view richer over time.
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
