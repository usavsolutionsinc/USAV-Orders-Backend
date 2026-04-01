'use client';

import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Loader2 } from '@/components/Icons';
import { getStaffThemeById, stationThemeColors } from '@/utils/staff-colors';
import type { DashboardData } from '@/features/operations/types';

const formatActivityType = (type: string) =>
  type.toLowerCase().split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');

function StaffGoalEntry({ s }: { s: DashboardData['staffProgress'][0] }) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(s.goal));
  const inputRef = useRef<HTMLInputElement>(null);

  const theme = getStaffThemeById(s.staffId);
  const colors = stationThemeColors[theme];

  const mutation = useMutation({
    mutationFn: async (newGoal: number) => {
      const res = await fetch('/api/staff-goals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffId: s.staffId,
          dailyGoal: newGoal,
          station: s.station,
        }),
      });
      if (!res.ok) throw new Error('Failed to update');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-goals-all'] });
      setIsEditing(false);
    },
  });

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const val = parseInt(editValue, 10);
    if (!isNaN(val) && val > 0 && val !== s.goal) {
      mutation.mutate(val);
    } else {
      setIsEditing(false);
      setEditValue(String(s.goal));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setIsEditing(false);
      setEditValue(String(s.goal));
    }
  };

  return (
    <div className="rounded-sm border border-slate-100 bg-white px-3 py-2.5 space-y-1.5 group transition-all hover:border-slate-200 hover:shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-5 h-5 rounded-sm ${colors.light} flex items-center justify-center text-[9px] font-black ${colors.text}`}>
            {s.name[0]}
          </div>
          <span className="text-[11px] font-bold text-slate-900">{s.name}</span>
        </div>
        <span className={`text-[9px] font-black uppercase tracking-widest ${s.status === 'on_track' ? 'text-emerald-600' : s.status === 'at_risk' ? 'text-amber-600' : 'text-rose-600'}`}>
          {s.status.replace('_', ' ')}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, s.percent)}%` }}
            className={`h-full ${colors.bg}`}
          />
        </div>
        
        <div className="relative flex items-center justify-end min-w-[40px]">
          <AnimatePresence mode="wait">
            {!isEditing ? (
              <motion.button
                key="display"
                initial={{ opacity: 0, x: 5 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -5 }}
                onClick={() => setIsEditing(true)}
                className="text-[10px] font-black tabular-nums text-slate-600 hover:text-blue-600 transition-colors flex items-center gap-0.5"
              >
                <span>{s.current}</span>
                <span className="text-slate-300">/</span>
                <span className="underline decoration-slate-200 underline-offset-2 decoration-2 hover:decoration-blue-400">{s.goal}</span>
              </motion.button>
            ) : (
              <motion.div
                key="edit"
                initial={{ opacity: 0, x: 5 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -5 }}
                className="flex items-center gap-1"
              >
                <span className="text-[10px] font-black tabular-nums text-slate-400">{s.current}/</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={handleSave}
                  disabled={mutation.isPending}
                  className="w-7 bg-blue-50/50 border-b-2 border-blue-500 text-[10px] font-black tabular-nums text-blue-700 outline-none text-center py-0"
                />
                {mutation.isPending && (
                  <Loader2 className="w-2.5 h-2.5 animate-spin text-blue-500 absolute -right-4" />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export function OperationsSidebarPanel() {
  const { data: staffGoals = [] } = useQuery<DashboardData['staffProgress']>({
    queryKey: ['staff-goals-all'],
    queryFn: async () => {
      const res = await fetch('/api/staff-goals');
      if (!res.ok) throw new Error('Failed');
      const rows: Array<{
        staff_id: number;
        name: string;
        station: string;
        daily_goal: number;
        today_count: number;
      }> = await res.json();
      return rows.map((r) => {
        const percent = r.daily_goal > 0 ? Math.round((r.today_count / r.daily_goal) * 100) : 0;
        let status: 'on_track' | 'at_risk' | 'behind' = 'behind';
        if (percent >= 85) status = 'on_track';
        else if (percent >= 60) status = 'at_risk';
        return {
          staffId: r.staff_id,
          name: r.name,
          goal: r.daily_goal,
          current: r.today_count,
          percent,
          status,
          daysLate: 0,
          station: r.station,
        };
      });
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const { data: feedData } = useQuery<Pick<DashboardData, 'activityFeed'>>({
    queryKey: ['dashboard-activity-feed'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/operations?timeRange=24h');
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    staleTime: 60000,
  });

  const sortedStaffGoals = useMemo(
    () => [...staffGoals].sort((a, b) => b.percent - a.percent),
    [staffGoals]
  );

  return (
    <div className="h-full overflow-y-auto px-3 py-4 space-y-6 bg-white border-r border-slate-200">
      {/* Staff Performance */}
      <section className="space-y-3">
        <p className="px-1 text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Staff Goals</p>
        <div className="space-y-2">
          {sortedStaffGoals.map((s) => (
            <StaffGoalEntry key={`${s.staffId}-${s.station}`} s={s} />
          ))}
        </div>
      </section>

      {/* Live Audit Trail */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <Activity className="w-3 h-3 text-blue-500" />
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">Live Feed</p>
        </div>
        <div className="space-y-3">
          {(feedData?.activityFeed || []).map((event) => {
            const theme = getStaffThemeById(event.staff_id || 0);
            const colors = stationThemeColors[theme];
            return (
              <div key={event.id} className="flex gap-2.5 group">
                <div className={`shrink-0 w-5 h-5 rounded-sm ${colors.light} flex items-center justify-center text-[9px] font-black ${colors.text} border border-slate-100`}>
                  {(event.actor_name || '?')[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between items-baseline mb-0.5">
                    <span className="text-[10px] font-bold text-slate-900">{event.actor_name}</span>
                    <span className="text-[9px] font-medium text-slate-400">
                      {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-snug line-clamp-2">
                    <span className="font-bold text-slate-700 uppercase tracking-tighter mr-1">{formatActivityType(event.type)}:</span>
                    {event.summary}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
