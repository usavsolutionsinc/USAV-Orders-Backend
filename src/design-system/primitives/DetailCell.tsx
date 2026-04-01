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
    <div className={`rounded-xl bg-gray-50 ${isMobile ? 'px-3 py-2.5' : 'px-3 py-2'} ${className}`}>
      <div className="mb-1 text-gray-500">{label}</div>
      <div className={`${
        isMobile
          ? 'text-[12px] font-bold text-gray-900 normal-case tracking-normal'
          : 'text-[11px] font-bold text-gray-900 normal-case tracking-normal'
      }`}>
        {children}
      </div>
    </div>
  );
}
