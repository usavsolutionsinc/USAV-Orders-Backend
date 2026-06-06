'use client';

import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { weekHeaderHighContrastDateClass } from '@/components/ui/WeekHeader';
import { formatDateWithOrdinal } from '@/utils/date';
import { cn } from '@/utils/_cn';

interface DesktopDateGroupHeaderProps {
  date: string;
  total: number;
  className?: string;
  /** Optional controls rendered to the left of the count (e.g. a print button). */
  actions?: ReactNode;
  /** Keep scroll-tracking attrs but hide the band (e.g. when WeekHeader already shows this day). */
  hidden?: boolean;
}

export function DesktopDateGroupHeader({
  date,
  total,
  className,
  actions,
  hidden = false,
}: DesktopDateGroupHeaderProps) {
  return (
    <div
      data-day-header
      data-date={date}
      data-count={total}
      className="relative"
    >
      <AnimatePresence initial={false}>
        {!hidden && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
            aria-hidden={hidden}
          >
            <div
              className={cn(
                'z-10 flex items-center justify-between border-y border-gray-300 bg-gray-50/80 px-3 py-1',
                className,
              )}
            >
              <p className={weekHeaderHighContrastDateClass}>{formatDateWithOrdinal(date)}</p>
              <div className="flex items-center gap-2">
                {actions}
                <p className="pr-1 font-dm-sans text-caption font-semibold tabular-nums text-gray-900">{total}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
