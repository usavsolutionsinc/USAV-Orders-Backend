'use client';

import React from 'react';
import { motion } from 'framer-motion';
import type { DashboardData } from '@/features/operations/types';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

interface StaffGoalsRailProps {
  staffProgress: DashboardData['staffProgress'] | undefined;
  isLoading?: boolean;
}

const STATUS_TONE = {
  on_track: { ring: '#6B9080', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700',  label: 'On track' },
  at_risk:  { ring: '#F59E0B', dot: 'bg-amber-500',   chip: 'bg-amber-50 text-amber-700',      label: 'Close to goal' },
  behind:   { ring: '#E07A5F', dot: 'bg-rose-500',    chip: 'bg-rose-50 text-rose-700',        label: 'Behind'   },
} as const;

function GoalRing({ percent, color }: { percent: number; color: string }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative w-[64px] h-[64px] shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={radius} stroke="#F0EDE8" strokeWidth="5" fill="none" />
        <motion.circle
          cx="32"
          cy="32"
          r={radius}
          stroke={color}
          strokeWidth="5"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - clamped / 100) }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[12px] font-extrabold text-[#2D2A26] tabular-nums tracking-tight">
          {clamped}%
        </span>
      </div>
    </div>
  );
}

function StaffGoalCard({ row, index }: {
  row: DashboardData['staffProgress'][number];
  index: number;
}) {
  const tone = STATUS_TONE[row.status] ?? STATUS_TONE.behind;
  const initials = row.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -2 }}
      className="bg-white rounded-[20px] border border-[#F0EDE8] p-4 flex items-center gap-3
                 shadow-[0_2px_12px_rgba(161,140,90,0.04)]
                 hover:shadow-[0_4px_18px_rgba(161,140,90,0.08)]
                 transition-shadow min-w-[260px] sm:min-w-0"
    >
      <GoalRing percent={row.percent} color={tone.ring} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-full bg-[#F5F3EF] text-[#6B6356] text-[9px] font-extrabold flex items-center justify-center shrink-0">
            {initials || '··'}
          </div>
          <p className="text-[13px] font-bold text-[#2D2A26] truncate leading-tight">
            {row.name}
          </p>
        </div>
        <p className="text-[10px] font-bold text-[#A89F91] uppercase tracking-[0.14em] mb-1.5">
          {row.station}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-[#6B6356] tabular-nums">
            {row.current} / {row.goal}
          </span>
          <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full ${tone.chip}`}>
            {tone.label}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export function StaffGoalsRail({ staffProgress, isLoading }: StaffGoalsRailProps) {
  const rows = staffProgress ?? [];
  const onTrack = rows.filter((r) => r.status === 'on_track').length;

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <span className={`${sectionLabel} !text-[#A89F91]`}>
            Staff goals · today
          </span>
          <h2 className="text-[20px] sm:text-[22px] font-extrabold tracking-tight text-[#2D2A26] mt-1">
            Who’s pacing where
          </h2>
        </div>
        {rows.length > 0 && (
          <span className="text-[11px] font-semibold text-[#A89F91] tabular-nums shrink-0">
            <span className="text-[#2D2A26] font-extrabold">{onTrack}</span>
            <span className="text-[#C4BAA8]">/{rows.length}</span> on track
          </span>
        )}
      </div>

      {isLoading && rows.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[100px] bg-white/60 rounded-[20px] border border-[#F0EDE8] animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-dashed border-[#E8E4DD] rounded-[20px] p-8 text-center">
          <p className="text-[13px] font-semibold text-[#6B6356]">No staff goals set yet.</p>
          <p className="text-[11px] text-[#A89F91] mt-1">Set daily goals from the staff settings to track progress here.</p>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0 pb-1">
          <div className="grid grid-flow-col auto-cols-[260px] sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 px-4 sm:px-0">
            {rows.map((row, i) => (
              <StaffGoalCard key={row.staffId} row={row} index={i} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
