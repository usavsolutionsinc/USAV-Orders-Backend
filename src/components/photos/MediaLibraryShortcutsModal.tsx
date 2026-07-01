'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@/components/Icons';

interface ShortcutRow {
  keys: string[];
  label: string;
}

/** Grid/page shortcuts (useMediaLibraryShortcuts). */
const GRID_SHORTCUTS: ShortcutRow[] = [
  { keys: ['1'], label: 'Small grid' },
  { keys: ['2'], label: 'Large grid' },
  { keys: ['3'], label: 'Folders' },
  { keys: ['4'], label: 'Group by ticket' },
  { keys: ['5'], label: 'List' },
  { keys: ['⌘', 'A'], label: 'Select all loaded (while selecting)' },
  { keys: ['Esc'], label: 'Exit selection' },
  { keys: ['?'], label: 'Show this help' },
];

/** Viewer shortcuts (owned by usePhotoGallery). */
const VIEWER_SHORTCUTS: ShortcutRow[] = [
  { keys: ['←', '→'], label: 'Previous / next photo' },
  { keys: ['+', '−'], label: 'Zoom in / out' },
  { keys: ['0'], label: 'Reset zoom' },
  { keys: ['R'], label: 'Rotate' },
  { keys: ['I'], label: 'Toggle details panel' },
  { keys: ['Esc'], label: 'Close viewer' },
];

function KeyCap({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-mini font-black uppercase tracking-widest text-gray-600">
      {children}
    </kbd>
  );
}

function ShortcutList({ title, rows }: { title: string; rows: ShortcutRow[] }) {
  return (
    <div className="space-y-1">
      <p className="text-eyebrow font-black uppercase tracking-widest text-gray-500">{title}</p>
      <ul className="divide-y divide-gray-100">
        {rows.map((row) => (
          <li key={`${title}-${row.label}`} className="flex items-center justify-between gap-4 py-1.5">
            <span className="truncate text-caption text-gray-700">{row.label}</span>
            <span className="flex shrink-0 items-center gap-1">
              {row.keys.map((k, i) => (
                <KeyCap key={i}>{k}</KeyCap>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Keyboard shortcut cheat sheet for the media library (toggled with `?`). */
export function MediaLibraryShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Media library keyboard shortcuts"
    >
      <div
        className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-caption font-bold text-gray-900">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts"
            className="-my-1 rounded p-1 text-gray-400 hover:bg-gray-50 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4">
          <ShortcutList title="Grid" rows={GRID_SHORTCUTS} />
          <ShortcutList title="Photo viewer" rows={VIEWER_SHORTCUTS} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
