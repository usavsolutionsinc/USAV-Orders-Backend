'use client';

import { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from '../Icons';
import { mainStickyHeaderClass } from '@/components/layout/header-shell';
import { getCurrentPSTDateKey } from '@/utils/date';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

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

/** Count in a day-group row (add `countClassName` from staff theme for accent parity with WeekHeader). */
export const weekDayGroupCountClass =
  'text-[11px] font-black tabular-nums text-gray-900';

interface WeekRange {
  startStr: string;
  endStr: string;
}

interface WeekHeaderProps {
  stickyDate: string;
  fallbackDate: string;
  count: number;
  countClassName: string;
  leftSlot?: ReactNode;
  weekRange?: WeekRange;
  weekOffset?: number;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  formatDate: (dateStr: string) => string;
  rightSlot?: ReactNode;
  showWeekControls?: boolean;
  /** When false, omits the sticky count after the date. */
  showCount?: boolean;
  /** Stronger type and control chrome for bright rooms / glare (e.g. dashboard shipped view). */
  highContrast?: boolean;
}

export default function WeekHeader({
  stickyDate,
  fallbackDate,
  count,
  countClassName,
  leftSlot,
  weekRange,
  weekOffset = 0,
  onPrevWeek,
  onNextWeek,
  formatDate,
  rightSlot,
  showWeekControls = true,
  showCount = true,
  highContrast = false,
}: WeekHeaderProps) {
  const getTodayPSTDisplay = () => {
    try {
      const today = getCurrentPSTDateKey();
      return today ? formatDate(today) : fallbackDate;
    } catch {
      return fallbackDate;
    }
  };

  const formattedTodayPST = (() => {
    try {
      const today = getCurrentPSTDateKey();
      return today ? formatDate(today) : '';
    } catch {
      return '';
    }
  })();

  const dateLineDisplay = stickyDate || getTodayPSTDisplay();
  const stickyDateLabel =
    formattedTodayPST && dateLineDisplay === formattedTodayPST ? 'Today' : dateLineDisplay;

  const dateTextClass = highContrast
    ? `text-sm font-black uppercase tracking-widest text-gray-900`
    : `text-[11px] font-black uppercase tracking-[0.2em] text-gray-900`;

  const countTextClass = highContrast
    ? `font-dm-sans text-sm font-semibold tabular-nums ${countClassName}`
    : `font-dm-sans text-[11px] font-semibold tabular-nums ${countClassName}`;

  const dashClass = highContrast ? 'shrink-0 text-sm text-neutral-500' : 'shrink-0 text-[11px] text-gray-500';

  return (
    <div className={mainStickyHeaderClass}>
      <div className={weekHeaderInnerRowClass}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {leftSlot ? <div className="shrink-0">{leftSlot}</div> : null}
          <p className={`min-w-0 truncate ${dateTextClass}`}>{stickyDateLabel}</p>
          {showCount ? <p className={`shrink-0 ${countTextClass}`}>{count}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {rightSlot ? (
            rightSlot
          ) : showWeekControls && weekRange && onPrevWeek && onNextWeek ? (
            <div className={`flex items-center ${highContrast ? 'gap-1.5' : 'gap-1'}`}>
              <span
                className={highContrast
                  ? 'text-[11px] font-black uppercase tracking-widest text-neutral-900'
                  : `${sectionLabel}`
                }
              >
                {formatDate(weekRange.startStr)} - {formatDate(weekRange.endStr)}
              </span>
              <button
                onClick={onPrevWeek}
                type="button"
                className={
                  highContrast
                    ? 'rounded-lg bg-neutral-300 p-1.5 text-neutral-900 transition-colors hover:bg-neutral-400 active:bg-neutral-500'
                    : 'rounded p-1 transition-colors hover:bg-gray-100'
                }
                title="Previous week"
              >
                <ChevronLeft className={highContrast ? 'h-5 w-5' : 'h-4 w-4 text-gray-600'} />
              </button>
              <button
                onClick={onNextWeek}
                type="button"
                disabled={weekOffset === 0}
                className={
                  highContrast
                    ? 'rounded-lg bg-neutral-300 p-1.5 text-neutral-900 transition-colors hover:bg-neutral-400 active:bg-neutral-500 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:opacity-100'
                    : 'rounded p-1 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30'
                }
                title="Next week"
              >
                <ChevronRight className={highContrast ? 'h-5 w-5' : 'h-4 w-4 text-gray-600'} />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
