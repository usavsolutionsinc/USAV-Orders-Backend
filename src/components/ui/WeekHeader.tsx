'use client';

import { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from '../Icons';
import { getCurrentPSTDateKey } from '@/lib/timezone';

interface WeekRange {
  startStr: string;
  endStr: string;
}

interface WeekHeaderProps {
  stickyDate: string;
  fallbackDate: string;
  count: number;
  countClassName: string;
  weekRange: WeekRange;
  weekOffset: number;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  formatDate: (dateStr: string) => string;
  rightSlot?: ReactNode;
}

export default function WeekHeader({
  stickyDate,
  fallbackDate,
  count,
  countClassName,
  weekRange,
  weekOffset,
  onPrevWeek,
  onNextWeek,
  formatDate,
  rightSlot,
}: WeekHeaderProps) {
  const getTodayPSTDisplay = () => {
    try {
      const today = getCurrentPSTDateKey();
      return today ? formatDate(today) : fallbackDate;
    } catch {
      return fallbackDate;
    }
  };

  return (
    <div className="flex-shrink-0 z-20 bg-white/95 backdrop-blur-md border-b border-gray-100 px-2 py-1 flex items-center justify-between shadow-sm">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-black text-gray-900 tracking-tight">
          {stickyDate || getTodayPSTDisplay()}
        </p>
        <div className="h-2 w-px bg-gray-200" />
        <p className={`text-[11px] font-black uppercase tracking-widest ${countClassName}`}>
          Count: {count}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {rightSlot ? (
          rightSlot
        ) : (
          <div className="flex items-center gap-1">
            <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest mr-1">
              {formatDate(weekRange.startStr)} - {formatDate(weekRange.endStr)}
            </span>
            <button
              onClick={onPrevWeek}
              className="p-1 hover:bg-gray-100 rounded transition-colors"
              title="Previous week"
            >
              <ChevronLeft className="w-4 h-4 text-gray-600" />
            </button>
            <button
              onClick={onNextWeek}
              disabled={weekOffset === 0}
              className="p-1 hover:bg-gray-100 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next week"
            >
              <ChevronRight className="w-4 h-4 text-gray-600" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
