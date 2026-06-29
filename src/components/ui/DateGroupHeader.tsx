'use client';

import type { ReactNode } from 'react';
import { formatDateWithOrdinal } from '@/utils/date';
import { cn } from '@/utils/_cn';

/**
 * Day-group header shown between each day's rows in every list/board table.
 *
 * It renders a single left-aligned **date + qty pill** — the same rounded-pill
 * language as the {@link DateRangeHeader} period pill — so the day separator and
 * the table's range header read as one family. The row is `position: sticky`, so
 * as a day's rows scroll past, the pill docks to the top of the scroll container
 * and *is* the live date header.
 *
 * One component for every table (packer / tech / shipped / orders / receiving /
 * repair / sales, desktop + mobile) and the swim-lane board lanes. There is no
 * longer a full-bleed "band" variant — the pill is the only day header.
 */

/** Sticky row wrapper — left-aligned, holds the floating date+qty pill. */
export const dayGroupChipRowClass = 'flex items-center px-3 py-1.5';

/** The date + qty pill — matches the DateRangeHeader period pill. */
export const dayGroupChipClass =
  'inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 shadow-sm';

interface DateGroupHeaderProps {
  date: string;
  total: number;
  /** Optional controls rendered inside the pill, right of the count (e.g. a print button). */
  actions?: ReactNode;
  /**
   * Stick to the top of the scroll container as the day's rows scroll past.
   * Default true. Set false for non-scrolling contexts (print, static lists).
   */
  sticky?: boolean;
  /**
   * Sticky offset utility. Default `top-0` — correct when the table header sits
   * *outside* the scroll container (the house pattern). Override only if a
   * header lives inside the same scroll viewport.
   */
  stickyTopClass?: string;
  className?: string;
}

export function DateGroupHeader({
  date,
  total,
  actions,
  sticky = true,
  stickyTopClass = 'top-0',
  className,
}: DateGroupHeaderProps) {
  return (
    <div
      data-date={date}
      className={cn(sticky && ['sticky z-raised', stickyTopClass], dayGroupChipRowClass, className)}
    >
      <span className={dayGroupChipClass}>
        <span className="text-caption font-black uppercase tracking-widest text-gray-900">
          {formatDateWithOrdinal(date)}
        </span>
        <span aria-hidden className="text-gray-300">•</span>
        <span className="text-caption font-bold tabular-nums text-gray-500">{total}</span>
        {actions}
      </span>
    </div>
  );
}
