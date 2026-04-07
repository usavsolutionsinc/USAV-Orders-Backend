'use client';

import { weekHeaderHighContrastDateClass } from '@/components/ui/WeekHeader';
import { formatDateWithOrdinal } from '@/utils/date';

interface DesktopDateGroupHeaderProps {
  date: string;
  total: number;
}

export function DesktopDateGroupHeader({
  date,
  total,
}: DesktopDateGroupHeaderProps) {
  return (
    <div
      data-day-header
      data-date={date}
      data-count={total}
      className="z-10 flex items-center justify-between border-y border-gray-300 bg-gray-50/80 px-3 py-1"
    >
      <p className={weekHeaderHighContrastDateClass}>{formatDateWithOrdinal(date)}</p>
      <p className="pr-1 font-dm-sans text-[11px] font-semibold tabular-nums text-gray-900">{total}</p>
    </div>
  );
}
