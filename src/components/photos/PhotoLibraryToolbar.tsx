'use client';

import type { ReactNode } from 'react';
import { X } from '@/components/Icons';
import {
  resolveSelectionAction,
  type SelectionAction,
} from '@/lib/selection/selection-actions';
import { cn } from '@/utils/_cn';

/** Expandable label — slower enter, delayed collapse so right→left hovers read cleanly. */
const ACTION_LABEL_CLASS =
  'overflow-hidden whitespace-nowrap transition-[max-width,margin-left,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] delay-150 motion-reduce:transition-none motion-reduce:delay-0 group-hover/action:delay-0 group-focus-visible/action:delay-0';

interface PhotoLibraryToolbarProps<T> {
  /** Currently-selected rows (the full cross-page selection). */
  rows: T[];
  /** Total selectable (loaded) count, for the "Select all N" affordance. */
  total: number;
  /** Bulk actions — same {@link SelectionAction} set the bottom bar used. */
  actions: SelectionAction<T>[];
  /** Optional control rendered before the action buttons (e.g. "Add to folder"). */
  leading?: ReactNode;
  onSelectAll: () => void;
  onClear: () => void;
}

/**
 * Inline bulk-action toolbar for the photo library, docked directly under the
 * page header instead of floating at the bottom of the viewport. Replaces
 * {@link ContextualSelectionBar} *on this page only* so the share button sits
 * "up" near the folder path, Finder-style — the shared bottom capsule stays in
 * use everywhere else. Icons are neutral gray; labels expand on hover with a
 * delayed collapse so scanning right→left stays readable. Count-gated via
 * {@link resolveSelectionAction}.
 */
export function PhotoLibraryToolbar<T>({
  rows,
  total,
  actions,
  leading,
  onSelectAll,
  onClear,
}: PhotoLibraryToolbarProps<T>) {
  const count = rows.length;
  const allSelected = total > 0 && count >= total;
  const visible = actions.filter((a) => !resolveSelectionAction(a, rows).disabled);

  return (
    <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50/80 px-4 py-2 backdrop-blur-sm lg:px-6">
      <span className="shrink-0 text-xs font-bold tabular-nums text-gray-700">
        {count} selected
      </span>
      <button
        type="button"
        onClick={allSelected ? onClear : onSelectAll}
        className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-blue-600 transition-colors hover:bg-blue-50"
      >
        {allSelected ? 'Clear' : `Select all ${total}`}
      </button>

      <div className="ml-auto flex items-center gap-1">
        {leading}
        {visible.map((a) => (
          <button
            key={a.key}
            type="button"
            title={a.label}
            aria-label={a.label}
            onClick={() => void a.run(rows)}
            className={cn(
              // Expandable icon button: gray icon always shows; label expands on
              // hover/focus with a delayed collapse so scanning right→left reads cleanly.
              'group/action inline-flex items-center rounded-lg px-2 py-1.5 text-xs font-semibold text-gray-600 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-900',
            )}
          >
            <span className="inline-flex shrink-0 text-gray-400 transition-colors duration-200 group-hover/action:text-gray-600 group-focus-visible/action:text-gray-600">
              {a.icon}
            </span>
            <span
              className={cn(
                ACTION_LABEL_CLASS,
                a.primary
                  ? 'ml-1.5 max-w-[10rem] opacity-100 delay-0'
                  : 'ml-0 max-w-0 opacity-0 group-hover/action:ml-1.5 group-hover/action:max-w-[10rem] group-hover/action:opacity-100 group-focus-visible/action:ml-1.5 group-focus-visible/action:max-w-[10rem] group-focus-visible/action:opacity-100',
              )}
            >
              {a.label}
            </span>
          </button>
        ))}
        <button
          type="button"
          aria-label="Clear selection"
          onClick={onClear}
          className="ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
