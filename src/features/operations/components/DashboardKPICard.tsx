'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp } from 'lucide-react';

type LucideIcon = React.ComponentType<{ className?: string; size?: number | string }>;

interface DashboardKPICardProps {
  title: string;
  value: string;
  subtext: string;
  trend: string;
  isPositive?: boolean;
  icon: LucideIcon | React.ComponentType<{ className?: string }>;
  colorTone?: 'blue' | 'purple' | 'emerald' | 'orange' | 'amber';
  chartType?: 'standard' | 'bar' | 'donut';
  progress?: number;
  /** Index 0-6 of the active day in the bar chart (default 5 = Friday) */
  activeBarIndex?: number;
  /** Caption that floats above the active bar (default = value) */
  barPeakLabel?: string;
}

const TONE = {
  blue:    { dot: 'bg-blue-500',    barActive: 'bg-blue-500',    soft: 'bg-blue-50',    text: 'text-blue-600' },
  purple:  { dot: 'bg-purple-500',  barActive: 'bg-purple-500',  soft: 'bg-purple-50',  text: 'text-purple-600' },
  emerald: { dot: 'bg-emerald-500', barActive: 'bg-emerald-500', soft: 'bg-emerald-50', text: 'text-emerald-600' },
  orange:  { dot: 'bg-orange-500',  barActive: 'bg-orange-500',  soft: 'bg-orange-50',  text: 'text-orange-600' },
  amber:   { dot: 'bg-[#F59E0B]',   barActive: 'bg-[#F59E0B]',   soft: 'bg-amber-50',   text: 'text-amber-700' },
} as const;

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * KPI card — large value with light decimal, week-of-bars + dot-footer (Lora Piterson "Progress" pattern).
 * The active bar carries a floating peak label; other bars are inert track lines.
 */
export const DashboardKPICard: React.FC<DashboardKPICardProps> = ({
  title,
  value,
  subtext,
  trend,
  isPositive = true,
  icon: Icon,
  colorTone = 'amber',
  chartType = 'bar',
  progress = 65,
  activeBarIndex = 5,
  barPeakLabel,
}) => {
  const tone = TONE[colorTone];

  // Split the value so the part after the first non-digit gets a lighter weight (Image 2/3 vibe)
  const valueMatch = value.match(/^([\d,]+)(.*)$/);
  const valueHead = valueMatch?.[1] ?? value;
  const valueTail = valueMatch?.[2] ?? '';

  // 7 bar heights — deterministic shape, active bar is tallest
  const heights = [38, 62, 44, 78, 56, 88, 48];

  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      className="bg-white rounded-[28px] shadow-[0_4px_24px_rgba(161,140,90,0.06)] p-5 sm:p-6 flex flex-col h-full relative"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <span className="text-[12px] font-semibold text-[#6B6356] tracking-tight">
          {title}
        </span>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${tone.soft} ${tone.text}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>

      {/* Big number with lighter tail */}
      <div className="flex items-baseline gap-1 mb-1">
        <span className="text-[34px] sm:text-[40px] font-extrabold text-[#2D2A26] tracking-tight leading-none tabular-nums">
          {valueHead}
        </span>
        {valueTail && (
          <span className="text-[20px] sm:text-[22px] font-medium text-[#C4BAA8] tracking-tight leading-none tabular-nums">
            {valueTail}
          </span>
        )}
      </div>
      <p className="text-[11px] font-medium text-[#A89F91] mb-4 leading-tight">
        {subtext}
      </p>

      {/* Chart area */}
      {chartType === 'bar' && (
        <div className="mt-auto">
          <div className="relative flex items-end justify-between gap-1 h-[72px] px-1">
            {/* Floating peak label above the active bar */}
            <div
              className="absolute -top-1 text-[10px] font-bold text-[#2D2A26] bg-white border border-[#F0EDE8] px-2 py-0.5 rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.04)] tabular-nums"
              style={{
                left: `calc(${(activeBarIndex / 6) * 100}% - 18px)`,
              }}
            >
              {barPeakLabel ?? trend}
            </div>

            {heights.map((h, i) => {
              const active = i === activeBarIndex;
              return (
                <motion.div
                  key={i}
                  initial={{ height: 0 }}
                  animate={{ height: `${h}%` }}
                  transition={{ duration: 0.8, delay: 0.1 + i * 0.05, ease: 'easeOut' }}
                  className={`w-1.5 rounded-full ${active ? tone.barActive : 'bg-[#E8E4DD]'}`}
                  style={{ minHeight: 6 }}
                />
              );
            })}
          </div>

          {/* Dot footer + day labels (Image 1 Progress card) */}
          <div className="flex items-center justify-between gap-1 mt-2 px-1">
            {DAYS.map((d, i) => {
              const active = i === activeBarIndex;
              return (
                <div key={i} className="flex flex-col items-center gap-1 w-1.5">
                  <span className={`w-1 h-1 rounded-full ${active ? tone.dot : 'bg-[#E8E4DD]'}`} />
                  <span className={`text-[9px] font-bold tracking-wide ${active ? 'text-[#2D2A26]' : 'text-[#C4BAA8]'}`}>
                    {d}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {chartType === 'donut' && (
        <div className="relative h-[88px] mt-auto flex items-center justify-center">
          <svg className="absolute inset-0 m-auto" width="88" height="88" viewBox="0 0 88 88">
            <circle cx="44" cy="44" r="36" stroke="#F0EDE8" strokeWidth="6" fill="none" />
            <motion.circle
              cx="44"
              cy="44"
              r="36"
              stroke={
                colorTone === 'amber'   ? '#F59E0B' :
                colorTone === 'emerald' ? '#10B981' :
                colorTone === 'blue'    ? '#3B82F6' :
                colorTone === 'orange'  ? '#F97316' : '#A855F7'
              }
              strokeWidth="6"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 36}
              initial={{ strokeDashoffset: 2 * Math.PI * 36 }}
              animate={{ strokeDashoffset: 2 * Math.PI * 36 * (1 - progress / 100) }}
              transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
              transform="rotate(-90 44 44)"
            />
          </svg>
          <div className="relative text-center">
            <div className="text-[20px] font-extrabold text-[#2D2A26] leading-none tabular-nums">{progress}%</div>
            <div className="text-[8px] font-black text-[#A89F91] uppercase tracking-[0.14em] mt-1">
              Capacity
            </div>
          </div>
        </div>
      )}

      {/* Trend pill — bottom-right floating */}
      <div className="mt-3 pt-3 border-t border-[#F5F3EF] flex items-center justify-between">
        <span className="text-[10px] font-bold text-[#A89F91] uppercase tracking-wider">
          7-day
        </span>
        <div
          className={`flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${
            isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
          }`}
        >
          <TrendingUp className={`w-3 h-3 ${!isPositive ? 'rotate-180' : ''}`} />
          <span className="tabular-nums">{trend}</span>
        </div>
      </div>
    </motion.div>
  );
};
