'use client';

import type { ReactNode } from 'react';
import { paneHeaderHighContrastTitleClass } from '@/components/ui/pane-header';
import { formatDateWithOrdinal } from '@/utils/date';
import { cn } from '@/utils/_cn';

/**
 * Day-group band shown between each day's rows in the week tables.
 *
 * It is `position: sticky`, so as a day's rows scroll past it docks to the top
 * of the scroll container and *is* the live date header — the {@link WeekHeader}
 * above it owns only week navigation + the week total, it no longer echoes the
 * active day. This replaces the old JS scroll-promotion (the `[data-day-header]`
 * handlers + pinned-sentinel `hidden` dance) with native CSS stickiness.
 *
 * One component for every week table (packer / tech / shipped / orders /
 * receiving / repair / sales, desktop + mobile). Supersedes the former
 * `DesktopDateGroupHeader`, `MobileDateGroupHeader`, `shipped/DateGroupHeader`,
 * and the `design-system` `DateGroupHeader`.
 */

/** Sticky gray band — high-contrast date on the left, count (+ optional actions) on the right. */
export const dayGroupBandClass =
  'flex items-center justify-between gap-4 border-y border-gray-300 bg-gray-50/95 px-3 py-1';

/** High-contrast date label — shares the PaneHeader title SoT (matches the old WeekHeader date). */
export const dayGroupDateClass = paneHeaderHighContrastTitleClass;

/** Tabular count rendered in the band. */
export const dayGroupCountClass =
  'font-dm-sans text-caption font-semibold tabular-nums text-gray-900';

interface DateGroupHeaderProps {
  date: string;
  total: number;
  /** Optional controls rendered just left of the count (e.g. a revenue chip or print button). */
  actions?: ReactNode;
  /**
   * Stick to the top of the scroll container as the day's rows scroll past.
   * Default true. Set false for non-scrolling contexts (print, static lists).
   */
  sticky?: boolean;
  /**
   * Sticky offset utility. Default `top-0` — correct when the WeekHeader sits
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
      className={cn(
        sticky && ['sticky z-raised', stickyTopClass],
        dayGroupBandClass,
        className,
      )}
    >
      <p className={dayGroupDateClass}>{formatDateWithOrdinal(date)}</p>
      <div className="flex items-center gap-2 pr-1">
        {actions}
        <p className={dayGroupCountClass}>{total}</p>
      </div>
    </div>
  );
}
