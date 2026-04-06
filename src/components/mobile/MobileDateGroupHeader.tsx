'use client';

import { cn } from '@/utils/_cn';
import {
  weekHeaderInnerRowClass,
  weekDayGroupBandClass,
  weekDayGroupDateClass,
  weekDayGroupCountClass,
} from '@/components/ui/WeekHeader';

interface MobileDateGroupHeaderProps {
  date: string;
  total: number;
  formatDate: (date: string) => string;
  countClassName?: string;
}

export function MobileDateGroupHeader({
  date,
  total,
  formatDate,
  countClassName,
}: MobileDateGroupHeaderProps) {
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
