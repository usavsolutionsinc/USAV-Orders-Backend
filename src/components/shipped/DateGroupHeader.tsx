'use client';

import { cn } from '@/utils/_cn';
import {
  weekHeaderInnerRowClass,
  weekDayGroupBandClass,
  weekDayGroupDateClass,
  weekDayGroupCountClass,
} from '@/components/ui/WeekHeader';

interface DateGroupHeaderProps {
  date: string;
  total: number;
  formatDate: (date: string) => string;
  /** Optional accent for the count (e.g. staff theme) — matches WeekHeader `countClassName` on mobile. */
  countClassName?: string;
}

/** Per-day band in shipped queues — same layout/typography as mobile tech/packer week-group rows. */
export function DateGroupHeader({ date, total, formatDate, countClassName }: DateGroupHeaderProps) {
  return (
    <div
      data-day-header
      data-date={date}
      data-count={total}
      className={cn(weekHeaderInnerRowClass, weekDayGroupBandClass)}
    >
      <p className={weekDayGroupDateClass}>{formatDate(date)}</p>
      <p className={cn(weekDayGroupCountClass, countClassName)}>{total}</p>
    </div>
  );
}
