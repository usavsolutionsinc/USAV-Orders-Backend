'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Trash2, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import {
  resolveSelectionAction,
  type SelectionAction,
} from '@/lib/selection/selection-actions';
import { cn } from '@/utils/_cn';
import { HoverTooltip } from '@/components/ui/HoverTooltip';

interface PhotoLibraryToolbarProps<T> {
  /** Currently-selected rows (the loaded subset of the cross-page selection). */
  rows: T[];
  /** Total selectable (loaded) count, for the "Select all N" affordance. */
  total: number;
  /**
   * True selection size — may exceed `rows.length` when "select all matching" has
   * pulled in ids that aren't loaded into the grid. Drives the "{n} selected"
   * label. Defaults to `rows.length`.
   */
  selectedCount?: number;
  /** Whether more pages match the current filters (enables "select all matching"). */
  hasMore?: boolean;
  /** Select every photo matching the current filters (server-resolved, capped). */
  onSelectAllMatching?: () => void;
  /** Bulk actions — same {@link SelectionAction} set the bottom bar used. */
  actions: SelectionAction<T>[];
  /** Optional control rendered before the action buttons (e.g. "Add to folder"). */
  leading?: ReactNode;
  /** Bulk delete — armed double-click, matching {@link PhotoViewerModal}. */
  onDeleteSelected?: (rows: T[]) => void | Promise<void>;
  onSelectAll: () => void;
  onClear: () => void;
}

/**
 * Inline bulk-action toolbar for the photo library, docked directly under the
 * page header instead of floating at the bottom of the viewport. Replaces
 * {@link ContextualSelectionBar} *on this page only* so bulk actions sit "up"
 * near the folder path, Finder-style. Primary actions show a static label;
 * everything else is icon-only with a tooltip. Delete uses a two-click arm
 * (same pattern as the shipped photo viewer). Count-gated via
 * {@link resolveSelectionAction}.
 */
export function PhotoLibraryToolbar<T>({
  rows,
  total,
  selectedCount,
  hasMore,
  onSelectAllMatching,
  actions,
  leading,
  onDeleteSelected,
  onSelectAll,
  onClear,
}: PhotoLibraryToolbarProps<T>) {
  const count = rows.length;
  const shownCount = selectedCount ?? count;
  const allSelected = total > 0 && count >= total;
  const visible = actions.filter((a) => !resolveSelectionAction(a, rows).disabled);

  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setDeleteArmed(false);
  }, [count]);

  const handleDeleteClick = useCallback(() => {
    if (!onDeleteSelected || deleting || count === 0) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      window.setTimeout(() => {
        setDeleteArmed((armed) => (armed ? false : armed));
      }, 4000);
      return;
    }
    setDeleting(true);
    void Promise.resolve(onDeleteSelected(rows)).finally(() => {
      setDeleting(false);
      setDeleteArmed(false);
    });
  }, [count, deleteArmed, deleting, onDeleteSelected, rows]);

  return (
    <div className="flex h-[40px] shrink-0 items-center gap-2 border-b border-gray-200 bg-gray-50/80 px-4 backdrop-blur-sm lg:px-6">
      <span className="shrink-0 text-xs font-bold tabular-nums text-gray-700">
        {shownCount} selected
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={allSelected ? onClear : onSelectAll}
        className="h-7 shrink-0 rounded-md px-1.5 py-0.5 text-caption font-bold uppercase tracking-wider text-blue-600 hover:bg-blue-50 hover:text-blue-700"
      >
        {allSelected ? 'Clear' : `Select all ${total}`}
      </Button>
      {hasMore && onSelectAllMatching ? (
        <HoverTooltip label="Select every photo matching the current filters" asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={onSelectAllMatching}
            className="h-7 shrink-0 rounded-md px-1.5 py-0.5 text-caption font-bold uppercase tracking-wider text-blue-600 hover:bg-blue-50 hover:text-blue-700"
          >
            Select all matching
          </Button>
        </HoverTooltip>
      ) : null}

      <div className="ml-auto flex items-center gap-1">
        {leading}
        {visible.map((a) =>
          a.primary ? (
            <button
              key={a.key}
              type="button"
              aria-label={a.label}
              onClick={() => void a.run(rows)}
              className="ds-raw-button inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-gray-600 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-900"
            >
              <span className="inline-flex shrink-0 text-gray-400">{a.icon}</span>
              <span className="whitespace-nowrap">{a.label}</span>
            </button>
          ) : (
            <HoverTooltip key={a.key} label={a.label} asChild>
              <IconButton
                ariaLabel={a.label}
                onClick={() => void a.run(rows)}
                icon={a.icon}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-700"
              />
            </HoverTooltip>
          ),
        )}
        {onDeleteSelected && count > 0 ? (
          <HoverTooltip
            label={deleteArmed ? 'Click again to confirm' : `Delete ${shownCount} selected photo${shownCount === 1 ? '' : 's'}`}
            asChild
          >
            {/* ds-raw-button: morphs icon-only ↔ icon+label on arm — same as PhotoViewerModal */}
            <button
              type="button"
              onClick={handleDeleteClick}
              disabled={deleting}
              aria-label={deleteArmed ? 'Confirm delete selected photos' : 'Delete selected photos'}
              className={cn(
                'ds-raw-button inline-flex items-center rounded-lg transition-colors duration-200 disabled:opacity-60',
                deleteArmed
                  ? 'gap-1.5 bg-red-50 px-2 py-1.5 text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-100'
                  : 'h-8 w-8 justify-center text-gray-400 hover:bg-gray-100 hover:text-red-600',
              )}
            >
              <Trash2 className="h-4 w-4 shrink-0" />
              {deleteArmed ? (
                <span className="text-xs font-bold uppercase tracking-wider">
                  {deleting ? 'Deleting…' : 'Confirm'}
                </span>
              ) : null}
            </button>
          </HoverTooltip>
        ) : null}
        <IconButton
          ariaLabel="Clear selection"
          onClick={onClear}
          icon={<X className="h-4 w-4" />}
          className="ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-200 hover:text-gray-700"
        />
      </div>
    </div>
  );
}
