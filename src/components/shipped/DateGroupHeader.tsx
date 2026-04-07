'use client';

import { DesktopDateGroupHeader } from '@/components/ui/DesktopDateGroupHeader';

interface DateGroupHeaderProps {
  date: string;
  total: number;
}

export function DateGroupHeader({ date, total }: DateGroupHeaderProps) {
  return (
    <DesktopDateGroupHeader
      date={date}
      total={total}
    />
  );
}
