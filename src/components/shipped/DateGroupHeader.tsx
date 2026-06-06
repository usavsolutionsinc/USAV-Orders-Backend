'use client';

import type { ReactNode } from 'react';
import { DesktopDateGroupHeader } from '@/components/ui/DesktopDateGroupHeader';

interface DateGroupHeaderProps {
  date: string;
  total: number;
  actions?: ReactNode;
  hidden?: boolean;
}

export function DateGroupHeader({ date, total, actions, hidden }: DateGroupHeaderProps) {
  return (
    <DesktopDateGroupHeader date={date} total={total} actions={actions} hidden={hidden} />
  );
}
