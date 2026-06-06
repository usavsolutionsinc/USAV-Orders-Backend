'use client';

import { cn } from '@/utils/_cn';
import { AnimatePresence, motion } from 'framer-motion';
import {
  weekHeaderInnerRowClass,
  weekDayGroupBandClass,
  weekDayGroupDateClass,
  weekDayGroupCountClass,
} from '@/components/ui/WeekHeader';
import { formatDateWithOrdinal } from '@/utils/date';

interface MobileDateGroupHeaderProps {
  date: string;
  total: number;
  hidden?: boolean;
}

export function MobileDateGroupHeader({
  date,
  total,
  hidden = false,
}: MobileDateGroupHeaderProps) {
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
            <div className={cn(weekHeaderInnerRowClass, weekDayGroupBandClass)}>
              <p className={weekDayGroupDateClass}>{formatDateWithOrdinal(date)}</p>
              <p className={weekDayGroupCountClass}>{total}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
