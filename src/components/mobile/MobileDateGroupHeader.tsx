'use client';

import { cn } from '@/utils/_cn';
import {
  weekHeaderInnerRowClass,
  weekDayGroupBandClass,
  weekDayGroupDateClass,
  weekDayGroupCountClass,
} from '@/components/ui/WeekHeader';
import { formatDateWithOrdinal } from '@/utils/date';

interface MobileDateGroupHeaderProps {
  date: string;
  total: number;
}

export function MobileDateGroupHeader({
  date,
  total,
}: MobileDateGroupHeaderProps) {
  return (
    <div
      data-day-header
      data-date={date}
      data-count={total}
      className={cn(weekHeaderInnerRowClass, weekDayGroupBandClass)}
    >
      <p className={weekDayGroupDateClass}>{formatDateWithOrdinal(date)}</p>
      <p className={weekDayGroupCountClass}>{total}</p>
    </div>
  );
}
