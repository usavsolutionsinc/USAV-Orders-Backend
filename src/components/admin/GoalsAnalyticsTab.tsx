'use client';

import { useEffect, useState } from 'react';
import { SearchBar } from '@/components/ui/SearchBar';

interface GoalRow {
  staff_id: number;
  name: string;
  role: string;
  daily_goal: number;
  today_count: number;
  week_count: number;
  avg_daily_last_7d: number;
}

export function GoalsAnalyticsTab() {
  const [rows, setRows] = useState<GoalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [goalInputs, setGoalInputs] = useState<Record<number, string>>({});
  const [searchTerm, setSearchTerm] = useState('');

  const fetchRows = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/staff-goals', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch goals');
      const data = await res.json();
      const normalized: GoalRow[] = Array.isArray(data) ? data : [];
      setRows(normalized);
      setGoalInputs(
        normalized.reduce<Record<number, string>>((acc, row) => {
          acc[row.staff_id] = String(row.daily_goal || 50);
          return acc;
        }, {})
      );
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
  }, []);

  const filteredRows = rows.filter((row) =>
    row.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
      await fetchRows();
    } catch (error) {
      console.error(error);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <SearchBar
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search technician..."
          className="flex-1 max-w-md w-full"
        />
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-gray-700">
            {filteredRows.length} technicians
          </span>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden">
        <div className="grid grid-cols-6 gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50">
          <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">Tech</p>
          <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">Daily Goal</p>
          <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">Today</p>
          <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">Week</p>
          <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">7D Avg</p>
          <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">Progress</p>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm font-bold text-gray-400 uppercase tracking-widest">
            Loading goals...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-8 text-center text-sm font-bold text-gray-400 uppercase tracking-widest">
            No technicians found
          </div>
        ) : (
          filteredRows.map((row) => {
            const goal = Math.max(1, Number(goalInputs[row.staff_id]) || row.daily_goal || 50);
            const progress = Math.min((row.today_count / goal) * 100, 100);
            return (
              <div key={row.staff_id} className="grid grid-cols-6 gap-3 px-4 py-3 border-b border-gray-100 last:border-b-0 items-center">
                <p className="text-xs font-black text-gray-900">{row.name}</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={goalInputs[row.staff_id] ?? String(row.daily_goal)}
                    onChange={(e) => setGoalInputs((prev) => ({ ...prev, [row.staff_id]: e.target.value }))}
                    className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-xs font-bold text-gray-900"
                  />
                  <button
                    type="button"
                    onClick={() => saveGoal(row.staff_id)}
                    disabled={savingId === row.staff_id}
                    className="h-8 px-2 rounded-lg bg-blue-600 text-white text-[9px] font-black uppercase tracking-wider disabled:opacity-50"
                  >
                    {savingId === row.staff_id ? 'Saving' : 'Save'}
                  </button>
                </div>
                <p className="text-xs font-black text-gray-900">{row.today_count}</p>
                <p className="text-xs font-black text-gray-900">{row.week_count}</p>
                <p className="text-xs font-black text-gray-900">{row.avg_daily_last_7d}</p>
                <div className="space-y-1">
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-[9px] font-bold text-gray-500 uppercase tracking-wider">
                    {Math.round(progress)}%
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
