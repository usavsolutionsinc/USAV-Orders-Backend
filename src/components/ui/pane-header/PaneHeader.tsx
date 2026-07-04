'use client';

import type { ReactNode } from 'react';
import { mainStickyHeaderClass } from '@/components/layout/header-shell';
import { cn } from '@/utils/_cn';

/** Inner row class — 40px target height, left/right justification, matches the existing WeekHeader shape. */
export const paneHeaderRowClass =
  'flex h-[40px] items-center justify-between gap-4 px-3 py-1';

interface PaneHeaderProps {
  /** Left side — typically icon badge + label/title block. Always laid out with `flex-1 min-w-0` so it truncates. */
  leftSlot?: ReactNode;
  /** Right side — actions, navigation, counts. Rendered as `shrink-0`. */
  rightSlot?: ReactNode;
  /** Optional second row below the main 44px row (e.g. search input + filter chips). */
  belowSlot?: ReactNode;
  /** Extra shell classes. Merged with the default `mainStickyHeaderClass` via tailwind-merge — pass conflicting utilities (e.g. `bg-surface-card`, `border-border-soft`) to override defaults. */
  className?: string;
  /** Extra row classes. Merged with the default `paneHeaderRowClass` — pass `px-4 sm:px-6` etc. to override padding. */
  rowClassName?: string;
  /** Optional max-width container around the row — for centered pages like Inventory/Products. */
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl';
}

const MAX_WIDTH_CLASS: Record<NonNullable<PaneHeaderProps['maxWidth']>, string> = {
  sm: 'mx-auto w-full max-w-sm',
  md: 'mx-auto w-full max-w-md',
  lg: 'mx-auto w-full max-w-lg',
  xl: 'mx-auto w-full max-w-xl',
  '2xl': 'mx-auto w-full max-w-2xl',
  '3xl': 'mx-auto w-full max-w-3xl',
  '4xl': 'mx-auto w-full max-w-4xl',
  '5xl': 'mx-auto w-full max-w-5xl',
  '6xl': 'mx-auto w-full max-w-6xl',
  '7xl': 'mx-auto w-full max-w-7xl',
};

/**
 * Matches utilities that grow the row past 44px or change its alignment in a
 * way that breaks sidebar alignment. Page headers must stay at 44px — callers
 * who need this kind of override are almost always rendering a detail-pane
 * header, in which case PaneHeader is correct but they should be aware they
 * are opting out of the page-header alignment contract.
 */
const ROW_HEIGHT_OVERRIDE_RE =
  /(?:^|\s)(?:py-|pt-|pb-|h-\d|min-h-)/;

export function PaneHeader({
  leftSlot,
  rightSlot,
  belowSlot,
  className,
  rowClassName,
  maxWidth,
}: PaneHeaderProps) {
  if (process.env.NODE_ENV !== 'production' && rowClassName && ROW_HEIGHT_OVERRIDE_RE.test(rowClassName)) {
    console.warn(
      'PaneHeader: `rowClassName` contains a height/vertical-padding override. ' +
        'For page-level headers (top of a route), use PageHeader instead — it locks the row at 44px so it aligns with the sidebar back button. ' +
        'PaneHeader with this override is appropriate for detail-pane headers (flyouts, side panels). ' +
        `Got: "${rowClassName}"`,
    );
  }

  const shell = cn(mainStickyHeaderClass, className);
  const row = cn(paneHeaderRowClass, rowClassName);
  const container = maxWidth ? MAX_WIDTH_CLASS[maxWidth] : null;

  const inner = (
    <>
      <div className={row}>
        <div className="flex min-w-0 flex-1 items-center gap-2">{leftSlot}</div>
        {rightSlot != null ? (
          <div className="flex shrink-0 items-center gap-2">{rightSlot}</div>
        ) : null}
      </div>
      {belowSlot}
    </>
  );

  return (
    <div className={shell}>
      {container ? <div className={container}>{inner}</div> : inner}
    </div>
  );
}
