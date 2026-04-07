'use client';

import { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from '../Icons';
import { mainStickyHeaderClass } from '@/components/layout/header-shell';
import { formatDateWithOrdinal, getCurrentPSTDateKey } from '@/utils/date';

/** Inner row for the week strip — use for sticky day/group rows so they align with WeekHeader. */
export const weekHeaderInnerRowClass =
  'flex min-h-[44px] items-center justify-between gap-4 px-3 py-1.5';

/**
 * Per-day band in scroll content — same look as the old sticky day row, but **not** sticky.
 * Only the weekly {@link WeekHeader} should stick; these rows scroll normally beneath it.
 */
export const weekDayGroupBandClass =
  'border-y border-gray-200 bg-gray-50/95';

/** Date label in a day-group row — matches mobile week tables + {@link DateGroupHeader}. */
export const weekDayGroupDateClass =
  'text-[11px] font-black uppercase tracking-[0.2em] text-gray-700';

/** Count in a day-group row. */
export const weekDayGroupCountClass =
  'text-[11px] font-black tabular-nums text-gray-900';

/** Desktop high-contrast date label for bright dashboard headers and matching day-group rows. */
export const weekHeaderHighContrastDateClass =
  'text-sm font-black uppercase tracking-widest text-gray-900';

interface WeekRange {
  startStr: string;
  endStr: string;
}

interface WeekHeaderProps {
  stickyDate: string;
  fallbackDate: string;
  count: number;
  leftSlot?: ReactNode;
  weekRange?: WeekRange;
  weekOffset?: number;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  rightSlot?: ReactNode;
}

export default function WeekHeader({
  stickyDate,
  fallbackDate,
  count,
  leftSlot,
  weekRange,
  weekOffset = 0,
  onPrevWeek,
  onNextWeek,
  rightSlot,
}: WeekHeaderProps) {
  const getTodayPSTDisplay = () => {
    try {
      const today = getCurrentPSTDateKey();
      return today ? formatDateWithOrdinal(today) : fallbackDate;
    } catch {
      return fallbackDate;
    }
  };

  const formattedTodayPST = (() => {
    try {
      const today = getCurrentPSTDateKey();
      return today ? formatDateWithOrdinal(today) : '';
    } catch {
      return '';
    }
  })();

  const dateLineDisplay = stickyDate || getTodayPSTDisplay();
  const stickyDateLabel =
    formattedTodayPST && dateLineDisplay === formattedTodayPST ? 'Today' : dateLineDisplay;

  return (
    <div className={mainStickyHeaderClass}>
      <div className={weekHeaderInnerRowClass}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {leftSlot ? <div className="shrink-0">{leftSlot}</div> : null}
          <p className={`min-w-0 truncate ${weekHeaderHighContrastDateClass}`}>{stickyDateLabel}</p>
          <p className="shrink-0 font-dm-sans text-sm font-semibold tabular-nums text-blue-700">{count}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {rightSlot ? (
            rightSlot
          ) : weekRange && onPrevWeek && onNextWeek ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-black uppercase tracking-widest text-neutral-900">
                {formatDateWithOrdinal(weekRange.startStr)} - {formatDateWithOrdinal(weekRange.endStr)}
              </span>
              <button
                onClick={onPrevWeek}
                type="button"
                className="rounded-lg bg-neutral-300 p-1.5 text-neutral-900 transition-colors hover:bg-neutral-400 active:bg-neutral-500"
                title="Previous week"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                onClick={onNextWeek}
                type="button"
                disabled={weekOffset === 0}
                className="rounded-lg bg-neutral-300 p-1.5 text-neutral-900 transition-colors hover:bg-neutral-400 active:bg-neutral-500 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:opacity-100"
                title="Next week"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
