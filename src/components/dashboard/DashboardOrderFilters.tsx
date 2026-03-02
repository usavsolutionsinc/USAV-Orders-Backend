'use client';

import { useEffect, useState } from 'react';
import { Calendar } from '@/components/Icons';

export interface DashboardOrderFiltersState {
  shipByDate: string;
}

export const DASHBOARD_ORDER_FILTERS_EVENT = 'dashboard-filters';

export const DEFAULT_DASHBOARD_ORDER_FILTERS: DashboardOrderFiltersState = {
  shipByDate: '',
};

interface DashboardOrderFilterToolbarProps {
  className?: string;
}

export function DashboardOrderFilterToolbar({
  className = '',
}: DashboardOrderFilterToolbarProps) {
  const [filters, setFilters] = useState<DashboardOrderFiltersState>(DEFAULT_DASHBOARD_ORDER_FILTERS);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(DASHBOARD_ORDER_FILTERS_EVENT, {
        detail: filters,
      })
    );
  }, [filters]);

  const updateFilter = <K extends keyof DashboardOrderFiltersState>(
    key: K,
    value: DashboardOrderFiltersState[K]
  ) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className={`rounded-2xl border border-gray-200 bg-white/90 p-3 shadow-sm ${className}`}>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label className="mb-1 block text-[9px] font-black uppercase tracking-widest text-gray-500">
            Ship Week
          </label>
          <div className="relative">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-blue-500" />
            <input
              type="week"
              value={filters.shipByDate}
              onChange={(e) => updateFilter('shipByDate', e.target.value)}
              className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-3 text-[10px] font-bold tracking-wide text-gray-800 outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setFilters(DEFAULT_DASHBOARD_ORDER_FILTERS)}
          disabled={!filters.shipByDate}
          className="h-10 shrink-0 rounded-xl border border-gray-200 px-4 text-[9px] font-black uppercase tracking-widest text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
