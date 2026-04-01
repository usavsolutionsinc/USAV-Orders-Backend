'use client';

import React from 'react';
import type { DashboardCategory } from '@/features/operations/types';

export type { DashboardCategory };

interface StatTileProps {
  category: DashboardCategory;
  label: string;
  value: number;
  delta?: number;
  icon?: React.ReactNode;
  isLoading?: boolean;
}

const CATEGORY_ACCENTS: Record<DashboardCategory, string> = {
  all: 'bg-slate-900',
  tested: 'bg-emerald-500',
  repair: 'bg-indigo-500',
  outOfStock: 'bg-orange-500',
  pendingLate: 'bg-rose-500',
  fba: 'bg-purple-500',
};

export function StatTile({ category, label, value, delta, icon, isLoading }: StatTileProps) {
  const accentColor = CATEGORY_ACCENTS[category];

  return (
    <div className="group relative flex flex-col justify-between h-[100px] bg-white px-4 py-3 transition-colors hover:bg-slate-50/80">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${accentColor} opacity-0 group-hover:opacity-100 transition-all duration-200`} />

      <div className="flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400 group-hover:text-slate-600 transition-colors truncate pr-2">
          {label}
        </span>
        <div className="text-slate-200 group-hover:text-slate-400 transition-colors">
          {icon && React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement, { className: 'w-3.5 h-3.5' }) : null}
        </div>
      </div>

      <div className="flex items-baseline gap-2 mt-1">
        {isLoading ? (
          <div className="h-7 w-16 bg-slate-100 animate-pulse rounded-sm" />
        ) : (
          <span className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
            {value.toLocaleString()}
          </span>
        )}

        {delta !== undefined && delta !== 0 && (
          <span className={`text-[10px] font-bold tabular-nums ${delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {delta > 0 ? '\u2191' : '\u2193'}{Math.abs(delta)}%
          </span>
        )}
      </div>

      <div className="h-0.5 w-full bg-slate-50 overflow-hidden rounded-full mt-2">
        <div
          className={`h-full ${accentColor} opacity-20 group-hover:opacity-40 transition-opacity`}
          style={{ width: `${Math.min(100, (value / 500) * 100)}%` }}
        />
      </div>
    </div>
  );
}
