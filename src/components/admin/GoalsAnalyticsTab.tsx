'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { invalidateStaffGoalsCache, getAllStaffGoals, type GoalRow } from '@/lib/staffGoalsCache';
import { mainStickyHeaderClass, mainStickyHeaderShellRowClass } from '@/components/layout/header-shell';

type GoalViewMode = 'all' | 'behind' | 'on-track' | 'exceeded';

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
      chipClass: 'bg-emerald-100 text-emerald-700',
      barClass: 'bg-emerald-500',
      railClass: 'bg-emerald-100',
    };
  }

  if (progress >= 0.7) {
    return {
      label: 'On Track',
      chipClass: 'bg-blue-100 text-blue-700',
      barClass: 'bg-blue-500',
      railClass: 'bg-blue-100',
    };
  }

  return {
    label: 'Behind',
    chipClass: 'bg-amber-100 text-amber-700',
    barClass: 'bg-amber-500',
    railClass: 'bg-amber-100',
  };
}

function matchesView(progress: number, goalView: GoalViewMode) {
  if (goalView === 'behind') return progress < 0.7;
  if (goalView === 'on-track') return progress >= 0.7 && progress < 1;
  if (goalView === 'exceeded') return progress >= 1;
  return true;
}

export function GoalsAnalyticsTab() {
  const searchParams = useSearchParams();
  const searchTerm = (searchParams.get('search') || '').trim().toLowerCase();
  const goalView = (searchParams.get('goalView') as GoalViewMode) || 'all';

  const [rows, setRows] = useState<GoalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [goalInputs, setGoalInputs] = useState<Record<number, string>>({});

  const fetchRows = async () => {
    setLoading(true);
    try {
      const normalized = await getAllStaffGoals();
      setRows(normalized);
      setGoalInputs((current) => {
        const next = { ...current };
        for (const row of normalized) {
          if (!next[row.staff_id]) next[row.staff_id] = String(row.daily_goal || 50);
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
  }, []);

  useEffect(() => {
    const handleRefresh = () => {
      invalidateStaffGoalsCache();
      fetchRows();
    };

    window.addEventListener('admin-goals-refresh', handleRefresh as EventListener);
    return () => window.removeEventListener('admin-goals-refresh', handleRefresh as EventListener);
  }, []);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const matchesSearch = !searchTerm || row.name.toLowerCase().includes(searchTerm);
      const { progress } = getProgress(row, goalInputs[row.staff_id]);
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
      const { progress } = getProgress(row, goalInputs[row.staff_id]);
      totals.today += row.today_count;
      totals.week += row.week_count;
      if (progress >= 1) totals.exceeded += 1;
      else if (progress < 0.7) totals.behind += 1;
    }

    return totals;
  }, [filteredRows, goalInputs]);

  const saveGoal = async (staffId: number) => {
    const parsedGoal = Number(goalInputs[staffId] || 0);
    if (!Number.isFinite(parsedGoal) || parsedGoal <= 0) return;

    setSavingId(staffId);
    try {
      const res = await fetch('/api/staff-goals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId, dailyGoal: parsedGoal }),
      });

      if (!res.ok) throw new Error('Failed to save goal');

      invalidateStaffGoalsCache(String(staffId));
      await fetchRows();
    } catch (error) {
      console.error(error);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-[linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)]">
      <div className={mainStickyHeaderClass}>
        <div className={`${mainStickyHeaderShellRowClass} px-6`}>
          <p className="truncate text-[11px] font-black uppercase tracking-[0.2em] text-slate-900">Daily Goal Analytics</p>
          <div className="hidden items-center gap-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 sm:flex">
            <span>Visible {summary.total}</span>
            <span className="text-slate-300">/</span>
            <span>Today {summary.today}</span>
            <span className="text-slate-300">/</span>
            <span>Week {summary.week}</span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-6 py-6">
        <div className="flex h-full min-h-0 flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Visible Staff</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">{summary.total}</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Today</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">{summary.today}</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">This Week</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">{summary.week}</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Exceeded / Behind</p>
              <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">
                {summary.exceeded}
                <span className="mx-1 text-slate-300">/</span>
                {summary.behind}
              </p>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white">
            <div className="grid grid-cols-[minmax(180px,1.4fr)_110px_90px_90px_90px_minmax(220px,1fr)] border-b border-slate-200 bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
              <p>Staff</p>
              <p>Daily Goal</p>
              <p>Today</p>
              <p>Week</p>
              <p>7D Avg</p>
              <p>Performance</p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex h-full items-center justify-center px-6 text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">
                  Loading goals...
                </div>
              ) : filteredRows.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 text-center">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">No Staff Matched</p>
                    <p className="mt-2 text-[12px] font-bold text-slate-500">
                      Adjust the goals sidebar filters or refresh the analytics feed.
                    </p>
                  </div>
                </div>
              ) : (
                filteredRows.map((row) => {
                  const { goal, percent, progress } = getProgress(row, goalInputs[row.staff_id]);
                  const tone = getPerformanceTone(progress);

                  return (
                    <div
                      key={row.staff_id}
                      className="grid grid-cols-[minmax(180px,1.4fr)_110px_90px_90px_90px_minmax(220px,1fr)] items-center border-b border-slate-200 px-4 py-3 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-black uppercase tracking-[0.08em] text-slate-900">{row.name}</p>
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{row.role}</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          value={goalInputs[row.staff_id] ?? String(row.daily_goal)}
                          onChange={(e) => setGoalInputs((current) => ({ ...current, [row.staff_id]: e.target.value }))}
                          className="w-16 border border-slate-200 bg-slate-50 px-2 py-2 text-[11px] font-black text-slate-900 outline-none focus:border-blue-400"
                        />
                        <button
                          type="button"
                          onClick={() => saveGoal(row.staff_id)}
                          disabled={savingId === row.staff_id}
                          className="border border-blue-200 bg-blue-50 px-2 py-2 text-[9px] font-black uppercase tracking-[0.2em] text-blue-700 disabled:opacity-50"
                        >
                          {savingId === row.staff_id ? 'Wait' : 'Save'}
                        </button>
                      </div>

                      <p className="text-[12px] font-black text-slate-900">{row.today_count}</p>
                      <p className="text-[12px] font-black text-slate-900">{row.week_count}</p>
                      <p className="text-[12px] font-black text-slate-900">{row.avg_daily_last_7d}</p>

                      <div>
                        <div className="flex items-center justify-between gap-3">
                          <span className={`px-2 py-1 text-[9px] font-black uppercase tracking-[0.22em] ${tone.chipClass}`}>
                            {tone.label}
                          </span>
                          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                            {row.today_count}/{goal}
                          </span>
                        </div>
                        <div className={`mt-2 h-2 overflow-hidden ${tone.railClass}`}>
                          <div className={`h-full ${tone.barClass}`} style={{ width: `${percent}%` }} />
                        </div>
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                          {Math.round(percent)}% complete today
                        </p>
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
