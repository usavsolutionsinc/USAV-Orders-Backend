'use client';

import { ReactNode, useMemo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/utils/_cn';
import {
  PaneHeader,
  PaneHeaderTitle,
  PaneHeaderCount,
  PaneHeaderWeekNav,
  paneHeaderRowClass,
  paneHeaderHighContrastTitleClass,
} from './pane-header';
import { formatDateWithOrdinal, formatWeekRangeCompact, getCurrentPSTDateKey } from '@/utils/date';

/** Inner row for the week strip — re-exported from the generalized PaneHeader so legacy callers keep working. */
export const weekHeaderInnerRowClass = paneHeaderRowClass;

/**
 * Per-day band in scroll content — same look as the old sticky day row, but **not** sticky.
 * Only the weekly {@link WeekHeader} should stick; these rows scroll normally beneath it.
 */
export const weekDayGroupBandClass =
  'border-y border-gray-300 bg-gray-50/95';

/** Date label in a day-group row — matches mobile week tables + {@link DateGroupHeader}. */
export const weekDayGroupDateClass =
  'text-caption font-black uppercase tracking-[0.2em] text-gray-700';

/** Count in a day-group row. */
export const weekDayGroupCountClass =
  'text-caption font-black tabular-nums text-gray-900';

/** Desktop high-contrast date label — alias of the generalized PaneHeader title class. */
export const weekHeaderHighContrastDateClass = paneHeaderHighContrastTitleClass;

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
  className?: string;
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
  className,
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

  const dateLineDisplay = useMemo(() => {
    if (!stickyDate) return getTodayPSTDisplay();
    // If it's already formatted (contains comma or ordinal suffix), return as is.
    if (stickyDate.includes(',') || stickyDate.includes('th') || stickyDate.includes('st') || stickyDate.includes('nd') || stickyDate.includes('rd')) {
      return stickyDate;
    }
    try {
      return formatDateWithOrdinal(stickyDate);
    } catch {
      return stickyDate;
    }
  }, [stickyDate, fallbackDate]);

  const stickyDateLabel =
    formattedTodayPST && dateLineDisplay === formattedTodayPST ? 'Today' : dateLineDisplay;

  const resolvedRightSlot =
    rightSlot ??
    (weekRange && onPrevWeek && onNextWeek ? (
      <PaneHeaderWeekNav
        rangeLabel={formatWeekRangeCompact(weekRange.startStr, weekRange.endStr)}
        onPrev={onPrevWeek}
        onNext={onNextWeek}
        weekOffset={weekOffset}
      />
    ) : null);

  return (
    <PaneHeader
      // Draw the divider as an inner line on the row (gray-300, matching the
      // sidebar bands + day-group rows) instead of the faint outer border on
      // the translucent sticky shell — keeps it aligned across columns.
      // Force bg-white to ensure it's opaque and covers docked headers.
      className={cn("border-b-0 bg-white shadow-sm", className)}
      rowClassName="border-b border-gray-300"
      leftSlot={
        <>
          {leftSlot ? <div className="shrink-0">{leftSlot}</div> : null}
          <PaneHeaderTitle className="flex">
            <motion.span 
              key={stickyDateLabel}
              layoutId={stickyDate ? `date-${stickyDate}` : undefined}
            >
              {stickyDateLabel}
            </motion.span>
          </PaneHeaderTitle>
          <motion.div layoutId={stickyDate ? `count-${stickyDate}` : undefined}>
            <PaneHeaderCount count={count} />
          </motion.div>
        </>
      }
      rightSlot={resolvedRightSlot}
    />
  );
}
