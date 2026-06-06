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
      className="sticky top-0 z-10"
    >
      <AnimatePresence initial={false}>
        {!hidden && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
            aria-hidden={hidden}
          >
            <div
              className={cn(
                'flex items-center justify-between border-y border-gray-300 bg-gray-50 px-3 py-1',
                className,
              )}
            >
              <motion.p layoutId={`date-${date}`} className={weekHeaderHighContrastDateClass}>
                {formatDateWithOrdinal(date)}
              </motion.p>
              <div className="flex items-center gap-2">
                {actions}
                <motion.p layoutId={`count-${date}`} className="pr-1 font-dm-sans text-caption font-semibold tabular-nums text-gray-900">
                  {total}
                </motion.p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
