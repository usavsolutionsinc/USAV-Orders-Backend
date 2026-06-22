'use client';

import type { ReactNode } from 'react';
import { cn } from '@/utils/_cn';

export interface ScrollPaneProps {
  children: ReactNode;
  className?: string;
  /** Forwarded to the scroll container (e.g. `tabIndex={0}` for keyboard nav). */
  tabIndex?: number;
}

/**
 * Flex-safe scroll region — always pair with a parent that has `min-h-0` and
 * participates in a flex column (`flex-1` or ratio split). Without `min-h-0`,
 * overflow-y-auto never activates and lists appear clipped or dead-space below.
 */
export function ScrollPane({ children, className, tabIndex }: ScrollPaneProps) {
  return (
    <div tabIndex={tabIndex} className={cn('min-h-0 flex-1 overflow-y-auto', className)}>
      {children}
    </div>
  );
}
