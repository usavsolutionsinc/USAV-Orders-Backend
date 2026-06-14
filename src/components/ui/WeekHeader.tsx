'use client';

import { ReactNode } from 'react';
import {
  PaneHeader,
  PaneHeaderTitle,
  PaneHeaderCount,
  PaneHeaderWeekNav,
} from './pane-header';
import { formatWeekRangeCompact } from '@/utils/date';

interface WeekRange {
  startStr: string;
  endStr: string;
}

interface WeekHeaderProps {
  /** Week total shown on the left. */
  count: number;
  /**
   * Optional left-side title (e.g. a board name, or "Today" for un-grouped
   * boards). Date-grouped tables omit it — the sticky {@link DateGroupHeader}
   * band inside the scroll container is the live date header.
   */
  label?: ReactNode;
  leftSlot?: ReactNode;
  weekRange?: WeekRange;
  weekOffset?: number;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  rightSlot?: ReactNode;
}

/**
 * Slim week-navigation bar: week total on the left, week range + prev/next on
 * the right.
 *
 * It deliberately does **not** track or echo the active day. Each week table's
 * day rows are separated by a sticky {@link DateGroupHeader} band that docks to
 * the top of the scroll container and serves as the live date header. This kept
 * the per-table `[data-day-header]` scroll handlers from having to exist at all.
 */
export default function WeekHeader({
  count,
  label,
  leftSlot,
  weekRange,
  weekOffset = 0,
  onPrevWeek,
  onNextWeek,
  rightSlot,
}: WeekHeaderProps) {
  const resolvedRightSlot =
    rightSlot ??
    (weekRange && onPrevWeek && onNextWeek ? (
      <PaneHeaderWeekNav
        rangeLabel={formatWeekRangeCompact(weekRange.startStr, weekRange.endStr)}
        onPrev={onPrevWeek}
        onNext={onNextWeek}
        weekOffset={weekOffset}
      />
    ) : null);

  return (
    <PaneHeader
      // Draw the divider as an inner line on the row (gray-300, matching the
      // sidebar bands + day-group bands) instead of the faint outer border on
      // the translucent sticky shell — keeps it aligned across columns.
      className="border-b-0"
      rowClassName="border-b border-gray-300"
      leftSlot={
        <>
          {leftSlot ? <div className="shrink-0">{leftSlot}</div> : null}
          {label ? <PaneHeaderTitle>{label}</PaneHeaderTitle> : null}
          <PaneHeaderCount count={count} />
        </>
      }
      rightSlot={resolvedRightSlot}
    />
  );
}
