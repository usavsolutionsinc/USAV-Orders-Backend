'use client';

import { DesktopDateGroupHeader } from '@/components/ui/DesktopDateGroupHeader';

interface DateGroupHeaderProps {
  date: string;
  total: number;
  formatDate: (date: string) => string;
  countClassName?: string;
}

export function DateGroupHeader({ date, total, formatDate, countClassName }: DateGroupHeaderProps) {
  return (
    <DesktopDateGroupHeader
      date={date}
      total={total}
      formatDate={formatDate}
      countClassName={countClassName}
    />
  );
}
