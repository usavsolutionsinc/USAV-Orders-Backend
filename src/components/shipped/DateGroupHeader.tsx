'use client';

import type { ReactNode } from 'react';
import { DesktopDateGroupHeader } from '@/components/ui/DesktopDateGroupHeader';

interface DateGroupHeaderProps {
  date: string;
  total: number;
  actions?: ReactNode;
}

export function DateGroupHeader({ date, total, actions }: DateGroupHeaderProps) {
  return (
    <DesktopDateGroupHeader
      date={date}
      total={total}
      actions={actions}
      className="border-t border-gray-300"
    />
  );
}
