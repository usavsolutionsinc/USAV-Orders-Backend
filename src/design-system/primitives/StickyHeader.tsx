'use client';

import type { ReactNode } from 'react';

export interface StickyHeaderProps {
  children: ReactNode;
  position?: 'top' | 'bottom';
  frosted?: boolean;
  className?: string;
}

const positionClass: Record<'top' | 'bottom', string> = {
  top: 'sticky top-0',
  bottom: 'sticky bottom-0',
};

/**
 * Sticky positioning primitive with optional frosted-glass backdrop.
 * Use for table date group headers, sidebar filter bars, panel headers.
 */
export function StickyHeader({
  children,
  position = 'top',
  frosted = false,
  className = '',
}: StickyHeaderProps) {
  return (
    <div
      className={[
        positionClass[position],
        'z-10',
        frosted ? 'bg-white/90 backdrop-blur-sm' : 'bg-white',
        className,
      ].join(' ').trim()}
    >
      {children}
    </div>
  );
}
