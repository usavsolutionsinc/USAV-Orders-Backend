'use client';

import { ReactNode } from 'react';
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
  'border-y border-gray-200 bg-gray-50/95';

/** Date label in a day-group row — matches mobile week tables + {@link DateGroupHeader}. */
export const weekDayGroupDateClass =
  'text-[11px] font-black uppercase tracking-[0.2em] text-gray-700';

/** Count in a day-group row. */
export const weekDayGroupCountClass =
  'text-[11px] font-black tabular-nums text-gray-900';

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

  const formattedStickyDate = stickyDate ? formatDateWithOrdinal(stickyDate) : '';
  const dateLineDisplay = formattedStickyDate || getTodayPSTDisplay();
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
      leftSlot={
        <>
          {leftSlot ? <div className="shrink-0">{leftSlot}</div> : null}
          <PaneHeaderTitle>{stickyDateLabel}</PaneHeaderTitle>
          <PaneHeaderCount count={count} />
        </>
      }
      rightSlot={resolvedRightSlot}
    />
  );
}
