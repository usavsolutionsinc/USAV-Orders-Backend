'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SearchBar } from '@/components/ui/SearchBar';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import { Loader2, RefreshCw, X } from '@/components/Icons';
import { sectionLabel, dataValue, fieldLabel } from '@/design-system/tokens/typography/presets';
import { getAllStaffGoals, invalidateStaffGoalsCache, type GoalRow } from '@/lib/staffGoalsCache';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';

const GOAL_VIEW_OPTIONS = [
  { value: 'all', label: 'All Staff' },
  { value: 'behind', label: 'Below 70%' },
  { value: 'on-track', label: '70% - 99%' },
  { value: 'exceeded', label: '100%+' },
] as const;

type GoalViewMode = (typeof GOAL_VIEW_OPTIONS)[number]['value'];

function emitGoalsRefresh() {
  window.dispatchEvent(new CustomEvent('admin-goals-refresh'));
}

function getGoalProgress(row: GoalRow) {
  const percent = row.daily_goal > 0 ? Math.round((row.today_count / row.daily_goal) * 100) : 0;
  return { percent, progress: row.daily_goal > 0 ? row.today_count / row.daily_goal : 0 };
}

function getGoalStatus(percent: number, current: number, goal: number) {
  if (percent <= 0 || current <= 0) {
    return { label: 'Not Started', className: 'text-slate-400' };
  }
  if (current > goal || percent > 100) {
    return { label: 'Above Goal', className: 'text-cyan-700' };
  }
  if (current === goal || percent === 100) {
    return { label: 'Hit Goal', className: 'text-emerald-700' };
  }
  if (percent >= 75) {
    return { label: 'On the Way', className: 'text-blue-700' };
  }
  if (percent >= 40) {
    return { label: 'Making Progress', className: 'text-sky-700' };
  }
  return { label: 'Getting Started', className: 'text-indigo-600' };
}

function matchesView(progress: number, goalView: GoalViewMode) {
  if (goalView === 'behind') return progress < 0.7;
  if (goalView === 'on-track') return progress >= 0.7 && progress < 1;
  if (goalView === 'exceeded') return progress >= 1;
  return true;
}

function CurrentGoalEntry({
  row,
  onSaved,
}: {
  row: GoalRow;
  onSaved: () => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(row.daily_goal));
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const theme = getStaffThemeById(row.staff_id);
  const colors = stationThemeColors[theme];
  const { percent } = getGoalProgress(row);
  const statusDisplay = getGoalStatus(percent, row.today_count, row.daily_goal);

  useEffect(() => {
    setEditValue(String(row.daily_goal));
  }, [row.daily_goal]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleSave = async () => {
    const nextGoal = parseInt(editValue, 10);
    if (!Number.isFinite(nextGoal) || nextGoal <= 0 || nextGoal === row.daily_goal) {
      setIsEditing(false);
      setEditValue(String(row.daily_goal));
      return;
    }

    try {
      setIsSaving(true);
      const res = await fetch('/api/staff-goals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffId: row.staff_id,
          dailyGoal: nextGoal,
          station: row.station,
        }),
      });

      if (!res.ok) throw new Error('Failed to save goal');

      invalidateStaffGoalsCache(String(row.staff_id));
      emitGoalsRefresh();
      await onSaved();
      setIsEditing(false);
    } catch (error) {
      console.error(error);
      setEditValue(String(row.daily_goal));
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-sm border border-slate-100 bg-white px-3 py-2.5 space-y-1.5 transition-all hover:border-slate-200 hover:shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`h-5 w-5 rounded-sm ${colors.light} flex items-center justify-center text-[9px] font-black ${colors.text}`}>
            {row.name[0]}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[11px] font-bold text-slate-900">{row.name}</p>
            <p className="truncate text-[9px] font-medium uppercase tracking-[0.12em] text-slate-400">
              {row.station}
            </p>
          </div>
        </div>
        <span className={`text-[9px] font-black uppercase tracking-widest ${statusDisplay.className}`}>
          {statusDisplay.label}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full ${colors.bg}`}
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </div>

        <div className="relative flex min-w-[44px] items-center justify-end">
          {!isEditing ? (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-0.5 text-[10px] font-black tabular-nums text-slate-600 transition-colors hover:text-blue-600"
            >
              <span>{row.today_count}</span>
              <span className="text-slate-300">/</span>
              <span className="underline decoration-slate-200 underline-offset-2 decoration-2 hover:decoration-blue-400">
                {row.daily_goal}
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-black tabular-nums text-slate-400">{row.today_count}/</span>
              <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => {
                  void handleSave();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleSave();
                  } else if (e.key === 'Escape') {
                    setIsEditing(false);
                    setEditValue(String(row.daily_goal));
                  }
                }}
                disabled={isSaving}
                className="w-8 border-b-2 border-blue-500 bg-blue-50/50 py-0 text-center text-[10px] font-black tabular-nums text-blue-700 outline-none"
              />
              {isSaving && (
                <Loader2 className="absolute -right-4 h-2.5 w-2.5 animate-spin text-blue-500" />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function GoalsSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchValue = searchParams.get('search') || '';
  const goalView = (searchParams.get('goalView') as GoalViewMode) || 'all';

  const [rows, setRows] = useState<GoalRow[]>([]);
  const [loading, setLoading] = useState(true);

  const updateParams = (patch: { search?: string; goalView?: GoalViewMode }) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('section', 'goals');

    if (patch.search !== undefined) {
      const value = patch.search.trim();
      if (value) nextParams.set('search', value);
      else nextParams.delete('search');
    }

    if (patch.goalView !== undefined) {
      if (patch.goalView === 'all') nextParams.delete('goalView');
      else nextParams.set('goalView', patch.goalView);
    }

    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/admin?${nextSearch}` : '/admin');
  };

  const clearFilters = () => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('section', 'goals');
    nextParams.delete('search');
    nextParams.delete('goalView');
    const nextSearch = nextParams.toString();
    router.replace(nextSearch ? `/admin?${nextSearch}` : '/admin');
  };

  const fetchRows = async () => {
    setLoading(true);
    try {
      const data = await getAllStaffGoals();
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRows();
  }, []);

  useEffect(() => {
    const handleRefresh = () => {
      invalidateStaffGoalsCache();
      void fetchRows();
    };

    window.addEventListener('admin-goals-refresh', handleRefresh as EventListener);
    return () => window.removeEventListener('admin-goals-refresh', handleRefresh as EventListener);
  }, []);

  const filteredRows = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase();

    return rows
      .filter((row) => {
        const matchesSearch =
          !normalizedSearch ||
          row.name.toLowerCase().includes(normalizedSearch) ||
          row.role.toLowerCase().includes(normalizedSearch);
        return matchesSearch && matchesView(getGoalProgress(row).progress, goalView);
      })
      .sort((a, b) => getGoalProgress(b).percent - getGoalProgress(a).percent || a.name.localeCompare(b.name));
  }, [goalView, rows, searchValue]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className="border-b border-gray-200">
        <ViewDropdown
          options={GOAL_VIEW_OPTIONS}
          value={goalView}
          onChange={(nextValue) => updateParams({ goalView: nextValue as GoalViewMode })}
          variant="boxy"
          buttonClassName={`h-full w-full appearance-none bg-white px-4 py-3 pr-8 text-left ${fieldLabel} outline-none transition-all hover:bg-gray-50`}
          optionClassName={fieldLabel}
        />
      </div>

      <div className="border-b border-gray-200 px-3 py-3">
        <SearchBar
          value={searchValue}
          onChange={(value) => updateParams({ search: value })}
          onClear={() => updateParams({ search: '' })}
          placeholder="Search staff or role"
          variant="blue"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        <section className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className={sectionLabel}>Current Goals</p>
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">
              {filteredRows.length}
            </span>
          </div>

          {loading ? (
            <div className="rounded-sm border border-dashed border-gray-200 px-3 py-4 text-xs text-gray-500">
              Loading current goal progress...
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="rounded-sm border border-dashed border-gray-200 px-3 py-4 text-xs text-gray-500">
              No current goal cards match this search or goal range.
            </div>
          ) : (
            <div className="space-y-2">
              {filteredRows.map((row) => (
                <CurrentGoalEntry
                  key={`${row.staff_id}-${row.station}`}
                  row={row}
                  onSaved={fetchRows}
                />
              ))}
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-sm border border-gray-200">
          <div className="border-b border-gray-200 px-4 py-3">
            <p className={sectionLabel}>Goal Tools</p>
          </div>

          <button
            type="button"
            onClick={() => {
              emitGoalsRefresh();
              void fetchRows();
            }}
            className="flex w-full items-center justify-between border-b border-gray-200 px-4 py-3 text-left transition-colors hover:bg-gray-50"
          >
            <div>
              <p className={dataValue}>Refresh Goal Data</p>
              <p className={`mt-0.5 ${fieldLabel} text-gray-500`}>Reload counts, goals, and KPI history</p>
            </div>
            <span className="inline-flex h-10 w-12 items-center justify-center border-l border-gray-200 text-gray-600">
              <RefreshCw className="h-3.5 w-3.5" />
            </span>
          </button>

          <button
            type="button"
            onClick={clearFilters}
            className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50"
          >
            <div>
              <p className={dataValue}>Clear Filters</p>
              <p className={`mt-0.5 ${fieldLabel} text-gray-500`}>Reset search and goal range filters</p>
            </div>
            <span className="inline-flex h-10 w-12 items-center justify-center border-l border-gray-200 text-gray-600">
              <X className="h-3.5 w-3.5" />
            </span>
          </button>
        </section>
      </div>
    </div>
  );
}
