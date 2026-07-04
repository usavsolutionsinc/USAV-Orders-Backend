'use client';

import { Fragment } from 'react';
import { Calendar, ChevronRight } from '@/components/Icons';
import { describePhotoDatePath } from '@/lib/photos/date-hierarchy';
import type { PhotoLibraryFilterState } from '@/lib/photos/library-filter-state';
import { claimsTicketLabel } from '@/lib/photos/display-names';
import { cn } from '@/utils/_cn';

interface PhotoDateBreadcrumbProps {
  filters: PhotoLibraryFilterState;
  onNavigate: (range: { dateFrom?: string; dateTo?: string }) => void;
  /** Today (PST `YYYY-MM-DD`) — the always-available "current day" jump. */
  today?: string;
  /** Most recent capture day (PST `YYYY-MM-DD`) across the loaded photos. */
  mostRecentDay?: string;
  /**
   * Active folder leaf (e.g. `PO 14-14825-46707`) — appended after the day
   * crumb. Prefer this over inferring from `filters.poRef` so scope-aware labels
   * (`Order …`, `Pickup …`) match the folder header.
   */
  folderLeafLabel?: string;
  /** @deprecated Leaf is shown in the path by default; pass `folderLeafLabel` instead. */
  hideFolderLeaf?: boolean;
}

/** `Mon, Jun 23` from a `YYYY-MM-DD` PST date string. */
function dayChipLabel(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00`);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

/**
 * The library's date breadcrumb in the right-panel context bar. When a
 * date is active it renders the simplified Year → Month → Week → Day path; with
 * no date it surfaces two quick jumps — **Today** and the **most recent** capture
 * day (both keyed off `created_at`, never the most-recent PO or photo type). The
 * root "All dates" crumb clears the filter; each path crumb widens to its span.
 *
 * When a PO folder is open the folder name is appended as the active leaf after
 * the day (`folderLeafLabel`, or derived from `filters.poRef` / `ticketId`).
 * Every date crumb above a folder leaf stays clickable — widening a date also
 * clears the PO (the parent's `onNavigate` resets `poRef`).
 */
export function PhotoDateBreadcrumb({
  filters,
  onNavigate,
  today,
  mostRecentDay,
  folderLeafLabel,
  hideFolderLeaf = false,
}: PhotoDateBreadcrumbProps) {
  const dateCrumbs = describePhotoDatePath(filters);
  const poRef = filters.poRef?.trim() || null;
  const ticketId = filters.ticketId?.trim() || null;
  const resolvedFolderLeaf =
    folderLeafLabel?.trim() ||
    (ticketId ? claimsTicketLabel(ticketId) : poRef ? `PO ${poRef}` : null);
  const showFolderLeaf = resolvedFolderLeaf !== null && !hideFolderLeaf;
  const hasDate = dateCrumbs.length > 0;
  // "All dates" can reset whenever there's a date OR a folder drill to clear.
  const canReset = hasDate || showFolderLeaf;
  const dateCrumbsRendered = showFolderLeaf
    ? dateCrumbs.map((crumb) => ({ ...crumb, current: false }))
    : dateCrumbs;
  const showQuickChips = !hasDate && !showFolderLeaf;
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
          // pl-0: align calendar icon with the folder icon in PhotoLibraryHeader (same px-4 gutter).
          'ds-raw-button flex shrink-0 items-center gap-1 rounded-md py-1 pl-0 pr-1.5 font-bold transition',
          canReset ? 'text-text-soft hover:bg-surface-hover hover:text-text-default' : 'text-text-default',
        )}
      >
        <Calendar className="h-3.5 w-3.5 text-text-faint" />
        <span>All dates</span>
      </button>

      {dateCrumbsRendered.map((crumb) => (
        <Fragment key={crumb.key}>
          <ChevronRight className="h-3 w-3 shrink-0 text-text-faint" />
          <button
            type="button"
            disabled={crumb.current}
            onClick={() => onNavigate(crumb.range)}
            className={cn(
              // ds-raw-button: breadcrumb nav crumb (disabled = current depth) — not a DS Button
              'ds-raw-button shrink-0 truncate rounded-md px-1.5 py-1 transition',
              crumb.current
                ? 'font-bold text-text-default'
                : 'font-semibold text-text-soft hover:bg-surface-hover hover:text-text-default',
            )}
          >
            {crumb.label}
          </button>
        </Fragment>
      ))}

      {showFolderLeaf ? (
        <Fragment key="folder-leaf">
          <ChevronRight className="h-3 w-3 shrink-0 text-text-faint" />
          <span className="shrink-0 truncate rounded-md px-1.5 py-1 font-bold text-text-default">
            {resolvedFolderLeaf}
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
      <ChevronRight className="h-3 w-3 shrink-0 text-text-faint" />
      {/* ds-raw-button: breadcrumb quick-jump nav crumb — not a DS Button */}
      <button
        type="button"
        onClick={onClick}
        className="ds-raw-button shrink-0 truncate rounded-md px-1.5 py-1 font-semibold text-text-soft transition hover:bg-surface-hover hover:text-text-default"
      >
        {label}
      </button>
    </>
  );
}
