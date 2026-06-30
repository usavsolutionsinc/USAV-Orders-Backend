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
 *
 * When a PO folder is open (`filters.poRef`) the PO# is appended as the active
 * leaf, and every date crumb above it stays clickable — widening a date also
 * clears the PO (the parent's `onNavigate` resets `poRef`).
 */
export function PhotoDateBreadcrumb({
  filters,
  onNavigate,
  today,
  mostRecentDay,
}: PhotoDateBreadcrumbProps) {
  const dateCrumbs = describePhotoDatePath(filters);
  const poRef = filters.poRef?.trim() || null;
  const hasDate = dateCrumbs.length > 0;
  // "All dates" can reset whenever there's a date OR a PO drill to clear.
  const canReset = hasDate || poRef !== null;
  // With a PO folder open, the PO# is the active leaf — so the date crumbs above it
  // are no longer the current depth and become clickable widen-targets again.
  const dateCrumbsRendered = poRef
    ? dateCrumbs.map((crumb) => ({ ...crumb, current: false }))
    : dateCrumbs;
  // Today / most-recent quick jumps only when there's nothing to path through.
  const showQuickChips = !hasDate && !poRef;
  // The most-recent chip is redundant when it equals today.
  const showRecent = Boolean(mostRecentDay && mostRecentDay !== today);

  return (
    <nav
      aria-label="Date path"
      className="flex min-w-0 items-center gap-0.5 overflow-x-auto text-label scrollbar-hide"
    >
      <button
        type="button"
        disabled={!canReset}
        onClick={() => onNavigate({ dateFrom: undefined, dateTo: undefined })}
        className={cn(
          // ds-raw-button: breadcrumb nav crumb (disabled = current depth) — not a DS Button
          'ds-raw-button flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-bold transition',
          canReset ? 'text-gray-500 hover:bg-gray-50 hover:text-gray-900' : 'text-gray-900',
        )}
      >
        <Calendar className="h-3.5 w-3.5 text-gray-400" />
        <span>All dates</span>
      </button>

      {dateCrumbsRendered.map((crumb) => (
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
      ))}

      {poRef ? (
        <Fragment key="po">
          <ChevronRight className="h-3 w-3 shrink-0 text-gray-300" />
          {/* The open PO is the active leaf — bold, non-interactive (you're here). */}
          <span className="shrink-0 truncate rounded-md px-1.5 py-1 font-bold text-gray-900">
            PO {poRef}
          </span>
        </Fragment>
      ) : null}

      {showQuickChips ? (
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
      ) : null}
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
