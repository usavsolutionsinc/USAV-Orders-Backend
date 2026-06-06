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
            <div className={cn(weekHeaderInnerRowClass, weekDayGroupBandClass)}>
              <motion.p layoutId={`date-${date}`} className={weekDayGroupDateClass}>{formatDateWithOrdinal(date)}</motion.p>
              <motion.p layoutId={`count-${date}`} className={weekDayGroupCountClass}>{total}</motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
