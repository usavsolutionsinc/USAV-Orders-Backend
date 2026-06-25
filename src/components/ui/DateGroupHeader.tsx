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

/** Slim "chip" variant — a small left-aligned pill wrapping the date + total,
 *  for dense embedded contexts (e.g. the shelf-board bubble cards) where the
 *  full-bleed band is too heavy. */
export const dayGroupChipRowClass = 'flex items-center px-3 py-1.5';
export const dayGroupChipClass =
  'inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-2.5 py-0.5 shadow-sm';

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
  /**
   * `band` (default) — the full-bleed bordered day band used by every week table.
   * `chip` — a slim left-aligned pill wrapping the date + total, for dense
   * embedded contexts (e.g. the shelf-board bubble cards).
   */
  variant?: 'band' | 'chip';
}

export function DateGroupHeader({
  date,
  total,
  actions,
  sticky = true,
  stickyTopClass = 'top-0',
  className,
  variant = 'band',
}: DateGroupHeaderProps) {
  if (variant === 'chip') {
    return (
      <div
        data-date={date}
        className={cn(sticky && ['sticky z-raised', stickyTopClass], dayGroupChipRowClass, className)}
      >
        <span className={dayGroupChipClass}>
          <span className="text-caption font-bold text-gray-900">{formatDateWithOrdinal(date)}</span>
          <span className="h-1 w-1 rounded-full bg-gray-300" />
          <span className="text-caption font-semibold tabular-nums text-gray-500">{total}</span>
          {actions}
        </span>
      </div>
    );
  }

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
