'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { invalidateStaffGoalsCache, getAllStaffGoals, type GoalRow } from '@/lib/staffGoalsCache';
import { mainStickyHeaderClass, mainStickyHeaderShellRowClass } from '@/components/layout/header-shell';

type GoalViewMode = 'all' | 'behind' | 'on-track' | 'exceeded';
type StationFilter = 'ALL' | 'TECH' | 'PACK';

function parseGoalView(value: string | null): GoalViewMode {
  if (value === 'behind' || value === 'on-track' || value === 'exceeded') return value;
  return 'all';
}

function getProgress(row: GoalRow, overrideValue?: string) {
  const goal = Math.max(1, Number(overrideValue) || row.daily_goal || 50);
  const progress = row.today_count / goal;
  return {
    goal,
    progress,
    percent: Math.min(progress * 100, 100),
  };
}

function getPerformanceTone(progress: number) {
  if (progress >= 1) {
    return {
      label: 'Exceeded',
      textClass: 'text-emerald-700',
      barClass: 'bg-emerald-600',
    };
  }

  if (progress >= 0.7) {
    return {
      label: 'On Track',
      textClass: 'text-blue-700',
      barClass: 'bg-blue-600',
    };
  }

  return {
    label: 'Behind',
    textClass: 'text-amber-700',
    barClass: 'bg-amber-600',
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

export function GoalsAnalyticsTab() {
  const searchParams = useSearchParams();
  const searchTerm = (searchParams.get('search') || '').trim().toLowerCase();
  const goalView = parseGoalView(searchParams.get('goalView'));

  const [rows, setRows] = useState<GoalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [goalInputs, setGoalInputs] = useState<Record<string, string>>({});
  const [stationFilter, setStationFilter] = useState<StationFilter>('ALL');
  const tableGridClass =
    'grid grid-cols-[minmax(180px,1.4fr)_80px_minmax(168px,1fr)_88px_88px_88px_minmax(220px,1fr)] gap-x-3';

  /** Composite key for a goal row: staffId:station */
  const rowKey = (row: GoalRow) => `${row.staff_id}:${row.station}`;

  const fetchRows = async () => {
    setLoading(true);
    try {
      const normalized = await getAllStaffGoals(
        stationFilter === 'ALL' ? undefined : stationFilter,
      );
      setRows(normalized);
      setGoalInputs((current) => {
        const next = { ...current };
        for (const row of normalized) {
          const key = rowKey(row);
          if (!next[key]) next[key] = String(row.daily_goal || 50);
        }
        return next;
      });
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationFilter]);

  useEffect(() => {
    const handleRefresh = () => {
      invalidateStaffGoalsCache();
      fetchRows();
    };

    window.addEventListener('admin-goals-refresh', handleRefresh as EventListener);
    return () => window.removeEventListener('admin-goals-refresh', handleRefresh as EventListener);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const matchesSearch = !searchTerm || row.name.toLowerCase().includes(searchTerm);
      const { progress } = getProgress(row, goalInputs[rowKey(row)]);
      return matchesSearch && matchesView(progress, goalView);
    });
  }, [goalInputs, goalView, rows, searchTerm]);

  const summary = useMemo(() => {
    const totals = {
      total: filteredRows.length,
      today: 0,
      week: 0,
      behind: 0,
      exceeded: 0,
    };

    for (const row of filteredRows) {
      const { progress } = getProgress(row, goalInputs[rowKey(row)]);
      totals.today += row.today_count;
      totals.week += row.week_count;
      if (progress >= 1) totals.exceeded += 1;
      else if (progress < 0.7) totals.behind += 1;
    }

    return totals;
  }, [filteredRows, goalInputs]);

  const saveGoal = async (row: GoalRow) => {
    const key = rowKey(row);
    const parsedGoal = Number(goalInputs[key] || 0);
    if (!Number.isFinite(parsedGoal) || parsedGoal <= 0) return;

    setSavingId(key);
    try {
      const res = await fetch('/api/staff-goals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffId: row.staff_id,
          dailyGoal: parsedGoal,
          station: row.station,
        }),
      });

      if (!res.ok) throw new Error('Failed to save goal');

      invalidateStaffGoalsCache(String(row.staff_id));
      await fetchRows();
    } catch (error) {
      console.error(error);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-white">
      <div className={mainStickyHeaderClass}>
        <div className={`${mainStickyHeaderShellRowClass} flex-wrap gap-y-2 px-6`}>
          <div className="flex items-center gap-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-900">Daily Goals</p>
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
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
            <span>{summary.total} staff shown</span>
            <span>{summary.today} done today</span>
            <span>{summary.week} this week</span>
            <span>
              {summary.exceeded} met goal / {summary.behind} behind
            </span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-6 py-5">
        <div className="flex h-full min-h-0 flex-col overflow-hidden border border-gray-200">
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[1020px]">
              <div
                className={`${tableGridClass} border-b border-gray-200 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500`}
              >
                <p>Staff</p>
                <p>Station</p>
                <p>Daily Goal</p>
                <p className="text-right">Done Today</p>
                <p className="text-right">This Week</p>
                <p className="text-right">7-Day Avg</p>
                <p>Performance</p>
              </div>

              {loading ? (
                <div className="flex h-full items-center justify-center px-6 py-10 text-xs text-gray-500">
                  Loading goal progress...
                </div>
              ) : filteredRows.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 py-10 text-center text-xs text-gray-500">
                  No staff match this search or goal view.
                </div>
              ) : (
                filteredRows.map((row) => {
                  const key = rowKey(row);
                  const { goal, percent, progress } = getProgress(row, goalInputs[key]);
                  const tone = getPerformanceTone(progress);

                  return (
                    <div
                      key={key}
                      className={`${tableGridClass} items-center border-b border-gray-200 px-4 py-3 text-sm last:border-b-0`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-gray-900">{row.name}</p>
                        <p className="truncate text-xs text-gray-500">{row.role}</p>
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

                      <div className="min-w-0 flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          value={goalInputs[key] ?? String(row.daily_goal)}
                          onChange={(e) => setGoalInputs((current) => ({ ...current, [key]: e.target.value }))}
                          aria-label={`Daily goal for ${row.name} (${row.station})`}
                          className="w-14 border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-900 outline-none focus:border-gray-500"
                        />
                        <button
                          type="button"
                          onClick={() => saveGoal(row)}
                          disabled={savingId === key}
                          className="shrink-0 border border-gray-300 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-700 disabled:opacity-50"
                        >
                          {savingId === key ? 'Saving' : 'Save'}
                        </button>
                      </div>

                      <p className="text-right font-semibold text-gray-900">{row.today_count}</p>
                      <p className="text-right font-semibold text-gray-900">{row.week_count}</p>
                      <p className="text-right font-semibold text-gray-900">{row.avg_daily_last_7d}</p>

                      <div className="min-w-0">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className={`font-semibold ${tone.textClass}`}>{tone.label}</span>
                          <span className="text-gray-500">
                            {row.today_count}/{goal}
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden bg-gray-100">
                          <div className={`h-full ${tone.barClass}`} style={{ width: `${percent}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
