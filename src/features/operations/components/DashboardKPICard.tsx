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
  /** When set, the entire card is clickable — opens the details modal */
  onOpen?: () => void;
}

const TONE = {
  blue:    { dot: 'bg-blue-500',    barActive: 'bg-blue-500',    soft: 'bg-blue-50',    text: 'text-blue-600' },
  purple:  { dot: 'bg-purple-500',  barActive: 'bg-purple-500',  soft: 'bg-purple-50',  text: 'text-purple-600' },
  emerald: { dot: 'bg-emerald-500', barActive: 'bg-emerald-500', soft: 'bg-emerald-50', text: 'text-emerald-600' },
  orange:  { dot: 'bg-orange-500',  barActive: 'bg-orange-500',  soft: 'bg-orange-50',  text: 'text-orange-600' },
  amber:   { dot: 'bg-amber-500',   barActive: 'bg-amber-500',   soft: 'bg-amber-50',   text: 'text-amber-700' },
} as const;

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

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
  onOpen,
}) => {
  const tone = TONE[colorTone];
  const clickable = Boolean(onOpen);

  const valueMatch = value.match(/^([\d,]+)(.*)$/);
  const valueHead = valueMatch?.[1] ?? value;
  const valueTail = valueMatch?.[2] ?? '';
  const heights = [38, 62, 44, 78, 56, 88, 48];

  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      onClick={clickable ? onOpen : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen?.();
              }
            }
          : undefined
      }
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-haspopup={clickable ? 'dialog' : undefined}
      aria-label={clickable ? `Show details for ${title}` : undefined}
      className={`relative flex h-full flex-col rounded-[28px] bg-white p-5 shadow-[0_4px_24px_rgba(161,140,90,0.06)] sm:p-6 ${
        clickable
          ? 'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500'
          : ''
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <span className="min-w-0 text-label font-semibold tracking-tight text-text-muted">{title}</span>
        <div className="flex shrink-0 items-start gap-1">
          <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${tone.soft} ${tone.text}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </div>

      <div className="mb-1 flex items-baseline gap-1">
        <span className="text-[34px] font-extrabold leading-none tracking-tight text-text-default tabular-nums sm:text-[40px]">
          {valueHead}
        </span>
        {valueTail && (
          <span className="text-[20px] font-medium leading-none tracking-tight text-text-soft tabular-nums sm:text-[22px]">
            {valueTail}
          </span>
        )}
      </div>
      <p className="mb-4 text-caption font-medium leading-tight text-text-muted">{subtext}</p>

      {chartType === 'bar' && (
        <div className="mt-auto">
          <div className="relative flex h-[72px] items-end justify-between gap-1 px-1">
            <div
              className="absolute -top-1 rounded-full border border-border-soft bg-white px-2 py-0.5 text-micro font-bold tracking-tighter text-text-default shadow-[0_2px_6px_rgba(0,0,0,0.04)] tabular-nums"
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
                  className={`w-1.5 rounded-full ${active ? tone.barActive : 'bg-surface-sunken'}`}
                  style={{ minHeight: 6 }}
                />
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between gap-1 px-1">
            {DAYS.map((d, i) => {
              const active = i === activeBarIndex;
              return (
                <div key={i} className="flex w-1.5 flex-col items-center gap-1">
                  <span className={`h-1 w-1 rounded-full ${active ? tone.dot : 'bg-surface-sunken'}`} />
                  <span
                    className={`text-eyebrow font-bold tracking-wide ${active ? 'text-text-default' : 'text-text-soft'}`}
                  >
                    {d}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {chartType === 'donut' && (
        <div className="relative mt-auto flex h-[88px] items-center justify-center">
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
            <div className="text-[20px] font-extrabold leading-none tracking-tighter text-text-default tabular-nums">{progress}%</div>
            <div className="mt-1 text-mini font-black uppercase tracking-[0.14em] text-text-muted">
              Capacity
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-border-soft pt-3">
        <span className="text-micro font-bold uppercase tracking-wider text-text-muted">7-day</span>
        <div
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-bold ${
            isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
          }`}
        >
          <TrendingUp className={`h-3 w-3 ${!isPositive ? 'rotate-180' : ''}`} />
          <span className="tabular-nums">{trend}</span>
        </div>
      </div>
    </motion.div>
  );
};
