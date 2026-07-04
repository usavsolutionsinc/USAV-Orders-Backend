'use client';

import { type ReactNode } from 'react';
import { useUIModeOptional } from '../providers/UIModeProvider';

interface DetailCellProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function DetailCell({ label, children, className = '' }: DetailCellProps) {
  const { isMobile } = useUIModeOptional();
  return (
    <div className={`rounded-xl bg-surface-canvas ${isMobile ? 'px-3 py-2.5' : 'px-3 py-2'} ${className}`}>
      <div className="mb-1 text-text-soft">{label}</div>
      <div className={`${
        isMobile
          ? 'text-label font-bold text-text-default normal-case tracking-normal'
          : 'text-caption font-bold text-text-default normal-case tracking-normal'
      }`}>
        {children}
      </div>
    </div>
  );
}
