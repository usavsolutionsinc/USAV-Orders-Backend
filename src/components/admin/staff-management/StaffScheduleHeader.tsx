'use client';

/**
 * Sticky header for the Staff Schedule tab — title + the shown / scheduled-today
 * / weekday summary line. Pure presentational. Extracted from StaffScheduleTab.
 */

import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { mainStickyHeaderClass, mainStickyHeaderShellRowClass } from '@/components/layout/header-shell';

interface StaffScheduleHeaderProps {
  total: number;
  presentToday: number;
  isBusinessDayToday: boolean;
  todayLabel: string;
}

export function StaffScheduleHeader({
  total,
  presentToday,
  isBusinessDayToday,
  todayLabel,
}: StaffScheduleHeaderProps) {
  return (
    <div className={mainStickyHeaderClass}>
      <div className={`${mainStickyHeaderShellRowClass} px-6`}>
        <p className={`${sectionLabel} truncate text-gray-900`}>Staff Schedule</p>
        <div className={`${sectionLabel} hidden items-center gap-3 sm:flex`}>
          <span>Shown {total}</span>
          <span className="text-gray-500">/</span>
          <span>Scheduled Today {isBusinessDayToday ? presentToday : 0}</span>
          <span className="text-gray-500">/</span>
          <span>{todayLabel}</span>
        </div>
      </div>
    </div>
  );
}
