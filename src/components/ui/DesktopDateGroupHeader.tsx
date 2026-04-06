'use client';

import { cn } from '@/utils/_cn';

interface DesktopDateGroupHeaderProps {
  date: string;
  total: number;
  formatDate: (date: string) => string;
  countClassName?: string;
}

export function DesktopDateGroupHeader({
  date,
  total,
  formatDate,
  countClassName,
}: DesktopDateGroupHeaderProps) {
  return (
    <div
      data-day-header
      data-date={date}
      data-count={total}
      className="z-10 flex items-center justify-between border-y border-gray-300 bg-gray-50/80 px-2 py-1"
    >
      <p className="text-[11px] font-black uppercase tracking-widest text-gray-900">{formatDate(date)}</p>
      <p className={cn('text-[11px] font-black tabular-nums text-gray-900', countClassName)}>{total}</p>
    </div>
  );
}
