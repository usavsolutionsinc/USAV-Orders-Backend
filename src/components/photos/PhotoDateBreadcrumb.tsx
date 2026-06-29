'use client';

import { Fragment } from 'react';
import { Calendar, ChevronRight } from '@/components/Icons';
import { describePhotoDatePath } from '@/lib/photos/date-hierarchy';
import type { PhotoLibraryFilterState } from '@/lib/photos/library-filter-state';
import { cn } from '@/utils/_cn';

interface PhotoDateBreadcrumbProps {
  filters: PhotoLibraryFilterState;
  onNavigate: (range: { dateFrom?: string; dateTo?: string }) => void;
  /** Today (PST `YYYY-MM-DD`) — the always-available "current day" jump. */
  today?: string;
  /** Most recent capture day (PST `YYYY-MM-DD`) across the loaded photos. */
  mostRecentDay?: string;
}

/** `Mon, Jun 23` from a `YYYY-MM-DD` PST date string. */
function dayChipLabel(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00`);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

/**
 * The library's date breadcrumb, pinned at the bottom of the right panel. When a
 * date is active it renders the simplified Year → Month → Week → Day path; with
 * no date it surfaces two quick jumps — **Today** and the **most recent** capture
 * day (both keyed off `created_at`, never the most-recent PO or photo type). The
 * root "All dates" crumb clears the filter; each path crumb widens to its span.
 */
export function PhotoDateBreadcrumb({
  filters,
  onNavigate,
  today,
  mostRecentDay,
}: PhotoDateBreadcrumbProps) {
  const crumbs = describePhotoDatePath(filters);
  const hasDate = crumbs.length > 0;
  // The most-recent chip is redundant when it equals today.
  const showRecent = Boolean(mostRecentDay && mostRecentDay !== today);

  return (
    <nav
      aria-label="Date path"
      className="flex min-w-0 items-center gap-0.5 overflow-x-auto text-label scrollbar-hide"
    >
      <button
        type="button"
        disabled={!hasDate}
        onClick={() => onNavigate({ dateFrom: undefined, dateTo: undefined })}
        className={cn(
          // ds-raw-button: breadcrumb nav crumb (disabled = current depth) — not a DS Button
          'ds-raw-button flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-bold transition',
          hasDate ? 'text-gray-500 hover:bg-gray-50 hover:text-gray-900' : 'text-gray-900',
        )}
      >
        <Calendar className="h-3.5 w-3.5 text-gray-400" />
        <span>All dates</span>
      </button>

      {hasDate ? (
        crumbs.map((crumb) => (
          <Fragment key={crumb.key}>
            <ChevronRight className="h-3 w-3 shrink-0 text-gray-300" />
            <button
              type="button"
              disabled={crumb.current}
              onClick={() => onNavigate(crumb.range)}
              className={cn(
                // ds-raw-button: breadcrumb nav crumb (disabled = current depth) — not a DS Button
                'ds-raw-button shrink-0 truncate rounded-md px-1.5 py-1 transition',
                crumb.current
                  ? 'font-bold text-gray-900'
                  : 'font-semibold text-gray-500 hover:bg-gray-50 hover:text-gray-900',
              )}
            >
              {crumb.label}
            </button>
          </Fragment>
        ))
      ) : (
        <>
          {today ? (
            <DateQuickChip label="Today" onClick={() => onNavigate({ dateFrom: today, dateTo: today })} />
          ) : null}
          {showRecent && mostRecentDay ? (
            <DateQuickChip
              label={`Recent · ${dayChipLabel(mostRecentDay)}`}
              onClick={() => onNavigate({ dateFrom: mostRecentDay, dateTo: mostRecentDay })}
            />
          ) : null}
        </>
      )}
    </nav>
  );
}

/** A small ghost chip offering a one-tap date jump (Today / most recent). */
function DateQuickChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <>
      <ChevronRight className="h-3 w-3 shrink-0 text-gray-300" />
      {/* ds-raw-button: breadcrumb quick-jump nav crumb — not a DS Button */}
      <button
        type="button"
        onClick={onClick}
        className="ds-raw-button shrink-0 truncate rounded-md px-1.5 py-1 font-semibold text-gray-500 transition hover:bg-gray-50 hover:text-gray-900"
      >
        {label}
      </button>
    </>
  );
}
