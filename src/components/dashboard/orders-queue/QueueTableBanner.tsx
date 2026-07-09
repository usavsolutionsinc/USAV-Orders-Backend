'use client';

import { sectionLabel, fieldLabel } from '@/design-system';
import { Loader2 } from '@/components/Icons';
import { mainStickyHeaderClass, mainStickyHeaderRowClass, mainStickyHeaderCompactRowClass } from '@/components/layout/header-shell';

export interface QueueTableBannerProps {
  title: string;
  subtitle?: string;
  /** Single-line 40px banner row (title + subtitle on one line). */
  compact?: boolean;
  isRefreshing?: boolean;
}

/** Sticky banner row above the queue, with an optional refresh spinner. */
export function QueueTableBanner({
  title,
  subtitle,
  compact = false,
  isRefreshing = false,
}: QueueTableBannerProps) {
  const rowClass = compact ? mainStickyHeaderCompactRowClass : mainStickyHeaderRowClass;

  return (
    <div className={mainStickyHeaderClass}>
      <div className={rowClass}>
        {compact ? (
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            <span className={`${sectionLabel} shrink-0 text-text-accent`}>{title}</span>
            {subtitle ? (
              <span className={`${fieldLabel} truncate text-text-muted`}>{subtitle}</span>
            ) : null}
          </div>
        ) : (
          <div>
            <p className={`${sectionLabel} text-text-accent`}>{title}</p>
            {subtitle ? (
              <p className={`${fieldLabel} mt-0.5 text-text-soft`}>{subtitle}</p>
            ) : null}
          </div>
        )}
        <div className="min-w-[18px] flex items-center justify-end">
          {isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin text-text-faint" /> : null}
        </div>
      </div>
    </div>
  );
}
