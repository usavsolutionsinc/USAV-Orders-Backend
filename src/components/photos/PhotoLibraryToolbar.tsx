'use client';

import type { ReactNode } from 'react';
import { X } from '@/components/Icons';
import {
  resolveSelectionAction,
  type SelectionAction,
} from '@/lib/selection/selection-actions';
import { cn } from '@/utils/_cn';

/** Tone → tinted ghost-button classes for the secondary bulk actions. */
const GHOST_TONE: Record<string, string> = {
  emerald: 'text-emerald-700 hover:bg-emerald-50',
  violet: 'text-violet-700 hover:bg-violet-50',
  blue: 'text-blue-700 hover:bg-blue-50',
  red: 'text-red-700 hover:bg-red-50',
  gray: 'text-gray-700 hover:bg-gray-100',
};

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
 * use everywhere else. The primary action (copy share links) renders solid; the
 * rest are tone-tinted ghost buttons, count-gated via {@link resolveSelectionAction}.
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
            onClick={() => void a.run(rows)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors',
              a.primary
                ? 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700'
                : (GHOST_TONE[a.tone ?? 'gray'] ?? GHOST_TONE.gray),
            )}
          >
            {a.icon}
            <span className="hidden sm:inline">{a.label}</span>
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
