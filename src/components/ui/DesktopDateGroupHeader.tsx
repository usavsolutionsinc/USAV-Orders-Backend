'use client';

import { weekHeaderHighContrastDateClass } from '@/components/ui/WeekHeader';
import { formatDateWithOrdinal } from '@/utils/date';
import { cn } from '@/utils/_cn';

interface DesktopDateGroupHeaderProps {
  date: string;
  total: number;
  className?: string;
}

export function DesktopDateGroupHeader({
  date,
  total,
  className,
}: DesktopDateGroupHeaderProps) {
  return (
    <div
      data-day-header
      data-date={date}
      data-count={total}
      className={cn(
        'z-10 flex items-center justify-between border-b border-gray-300 bg-gray-50/80 px-3 py-1',
        className,
      )}
    >
      <p className={weekHeaderHighContrastDateClass}>{formatDateWithOrdinal(date)}</p>
      <p className="pr-1 font-dm-sans text-caption font-semibold tabular-nums text-gray-900">{total}</p>
    </div>
  );
}
