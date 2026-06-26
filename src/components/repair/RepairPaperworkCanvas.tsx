'use client';

import React from 'react';
import { cn } from '@/utils/_cn';

interface RepairPaperworkCanvasProps {
  children: React.ReactNode;
  /** `full` — stretch to the host column width (review + signature alignment). */
  align?: 'fit' | 'full';
  /** `bordered` — square black frame (review form). `desk` — shadow on gray background. */
  frame?: 'desk' | 'bordered';
}

/** Repair document on a paper-on-desk canvas. */
export function RepairPaperworkCanvas({
  children,
  align = 'fit',
  frame = 'desk',
}: RepairPaperworkCanvasProps) {
  const isFull = align === 'full';
  const isBordered = frame === 'bordered';

  return (
    <div className={cn('overflow-x-auto', isFull && 'w-full')}>
      <div
        className={cn(
          'bg-white',
          isBordered
            ? 'border border-black'
            : 'shadow-lg ring-1 ring-gray-300',
          isFull ? 'w-full' : 'mx-auto w-fit',
        )}
      >
        {children}
      </div>
    </div>
  );
}
