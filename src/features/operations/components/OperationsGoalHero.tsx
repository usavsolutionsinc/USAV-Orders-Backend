'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Flag, TrendingUp } from '@/components/Icons';
import type { DashboardData } from '@/features/operations/types';

/**
 * OperationsGoalHero — the goal-first TOP section of the Operations page
 * (roadmap P3-ADM-01 acceptance A).
 *
 * It rolls the per-staff daily goals (org-scoped `staffProgress` from
 * /api/dashboard/operations) up into ONE floor-wide goal for today: today's
 * units done vs the sum of every active staffer's daily target. No new query
 * and no new polling — it derives purely from data the page already fetches
 * via useOperationsDashboardData (which polls 60s + Ably-patches).
 */

interface OperationsGoalHeroProps {
  staffProgress: DashboardData['staffProgress'] | undefined;
  isLoading?: boolean;
}

function toneFor(percent: number) {
  if (percent >= 100) return { ring: '#059669', label: 'Goal hit', chip: 'bg-emerald-50 text-emerald-700' };
  if (percent >= 85) return { ring: '#059669', label: 'On track', chip: 'bg-emerald-50 text-emerald-700' };
  if (percent >= 60) return { ring: '#D97706', label: 'Close', chip: 'bg-amber-50 text-amber-700' };
  return { ring: '#E11D48', label: 'Behind', chip: 'bg-rose-50 text-rose-700' };
}

function BigGoalRing({ percent, color }: { percent: number; color: string }) {
  const size = 132;
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg className="h-full w-full -rotate-90" viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#F0EDE8" strokeWidth="9" fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth="9"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - clamped / 100) }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[30px] font-extrabold leading-none tabular-nums tracking-tight text-text-default">
          {clamped}%
        </span>
        <span className="mt-0.5 text-eyebrow font-black uppercase tracking-[0.18em] text-text-muted">
          of goal
        </span>
      </div>
    </div>
  );
}

/** Per-station roll-up so the owner sees where the floor is pacing. */
function stationBreakdown(rows: DashboardData['staffProgress']) {
  const byStation = new Map<string, { current: number; goal: number }>();
  for (const r of rows) {
    const k = r.station || 'OTHER';
    const acc = byStation.get(k) ?? { current: 0, goal: 0 };
    acc.current += r.current;
    acc.goal += r.goal;
    byStation.set(k, acc);
  }
  return [...byStation.entries()]
    .map(([station, v]) => ({
      station,
      current: v.current,
      goal: v.goal,
      percent: v.goal > 0 ? Math.round((v.current / v.goal) * 100) : 0,
    }))
    .sort((a, b) => b.goal - a.goal);
}

export function OperationsGoalHero({ staffProgress, isLoading }: OperationsGoalHeroProps) {
  const rows = useMemo(() => staffProgress ?? [], [staffProgress]);

  const totals = useMemo(() => {
    const current = rows.reduce((s, r) => s + r.current, 0);
    const goal = rows.reduce((s, r) => s + r.goal, 0);
    const percent = goal > 0 ? Math.round((current / goal) * 100) : 0;
    const onTrack = rows.filter((r) => r.status === 'on_track').length;
    return { current, goal, percent, onTrack, staff: rows.length };
  }, [rows]);

  const stations = useMemo(() => stationBreakdown(rows), [rows]);
  const tone = toneFor(totals.percent);
  const remaining = Math.max(0, totals.goal - totals.current);

  if (isLoading && rows.length === 0) {
    return (
      <section className="h-[180px] animate-pulse rounded-[28px] border border-border-soft bg-white/60" />
    );
  }

  return (
    <section
      className="overflow-hidden rounded-[28px] border border-border-soft bg-white
                 shadow-[0_4px_24px_rgba(161,140,90,0.06)]"
    >
      <div className="flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-center">
        {/* ── Headline goal ── */}
        <div className="flex items-center gap-5">
          <BigGoalRing percent={totals.percent} color={tone.ring} />
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 text-micro font-black uppercase tracking-[0.2em] text-text-muted">
              <Flag className="h-3 w-3" /> Today’s goal
            </span>
            <h1 className="mt-1.5 text-[26px] font-extrabold leading-none tracking-tight text-text-default sm:text-[30px]">
              <span className="tabular-nums">{totals.current.toLocaleString()}</span>
              <span className="text-text-soft"> / {totals.goal.toLocaleString()}</span>
              <span className="ml-2 text-[14px] font-bold text-text-muted">units</span>
            </h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-micro font-black uppercase tracking-wider ${tone.chip}`}
              >
                {tone.label}
              </span>
              {totals.goal > 0 ? (
                <span className="inline-flex items-center gap-1 text-caption font-bold tabular-nums text-text-muted">
                  <span style={{ color: tone.ring }}>
                    <TrendingUp className="h-3 w-3" />
                  </span>
                  {remaining.toLocaleString()} to go
                </span>
              ) : (
                <span className="text-caption font-semibold text-text-muted">
                  No staff goals set yet
                </span>
              )}
              {totals.staff > 0 && (
                <span className="text-caption font-semibold tabular-nums text-text-muted">
                  · <span className="font-extrabold text-text-default">{totals.onTrack}</span>/
                  {totals.staff} on track
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Per-station pacing bars ── */}
        {stations.length > 0 && (
          <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:border-l lg:border-border-soft lg:pl-7">
            {stations.slice(0, 6).map((s) => {
              const st = toneFor(s.percent);
              return (
                <div key={s.station} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-micro font-black uppercase tracking-[0.12em] text-text-muted">
                      {s.station}
                    </span>
                    <span className="text-micro font-bold tabular-nums text-text-muted">
                      {s.current}/{s.goal}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-canvas">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: st.ring }}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, s.percent)}%` }}
                      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
