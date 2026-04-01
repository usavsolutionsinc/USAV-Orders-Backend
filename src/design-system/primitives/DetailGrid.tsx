'use client';

import { type ReactNode } from 'react';
import { useUIModeOptional } from '../providers/UIModeProvider';

interface DetailGridProps {
  children: ReactNode;
  className?: string;
}

export function DetailGrid({ children, className = '' }: DetailGridProps) {
  const { isMobile } = useUIModeOptional();
  return (
    <div
      className={`grid gap-2 ${
        isMobile
          ? 'grid-cols-1 sm:grid-cols-2 text-[11px] font-bold uppercase tracking-[0.16em] text-gray-700'
          : 'grid-cols-2'
      } ${className}`}
    >
      {children}
    </div>
  );
}
