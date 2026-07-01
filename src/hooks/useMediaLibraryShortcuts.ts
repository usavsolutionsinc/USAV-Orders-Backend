'use client';

import { useEffect } from 'react';

/**
 * Grid/page-level keyboard shortcuts for the media library (`/ops/photos`).
 *
 * These are the *grid* shortcuts only — the fullscreen viewer owns its own keys
 * (`←`/`→`/`Esc`/`+`/`-`/`0`/`r`/`i`, in usePhotoGallery). We deliberately bail
 * while the lightbox or any modal dialog is open so the two layers never fight
 * over the same key, and while focus is in an editable field so `⌘A` selects
 * text and digits type normally.
 */
export interface MediaLibraryShortcutHandlers {
  /** When false, the listener is not attached (e.g. page not focused). Default true. */
  enabled?: boolean;
  /** Whether selection mode is currently active — gates `⌘/Ctrl+A`. */
  selectionActive: boolean;
  /** `?` — toggle the shortcuts cheat sheet. */
  onToggleHelp: () => void;
  /** `⌘/Ctrl+A` while selecting — select all loaded photos. */
  onSelectAll: () => void;
  /** `Esc` — exit selection / dismiss transient chrome. */
  onEscape: () => void;
  /** `1`–`5` — switch view by index into PHOTO_LIBRARY_VIEW_ORDER. */
  onSelectViewIndex: (index: number) => void;
}

/** True when focus is in a control that should own the keystroke itself. */
function isEditableTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || typeof node.tagName !== 'string') return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable === true;
}

/**
 * True when a fullscreen viewer (portaled `data-testid="photo-lightbox"`) or any
 * modal dialog (`role="dialog"`, e.g. the cheat sheet, Zendesk modal, label
 * editor) is mounted — in which case the grid shortcuts stand down.
 */
function overlayOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return !!document.querySelector('[data-testid="photo-lightbox"], [role="dialog"]');
}

export function useMediaLibraryShortcuts(handlers: MediaLibraryShortcutHandlers): void {
  const {
    enabled = true,
    selectionActive,
    onToggleHelp,
    onSelectAll,
    onEscape,
    onSelectViewIndex,
  } = handlers;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target) || overlayOpen()) return;

      // `?` (Shift+/ on US layouts) toggles the cheat sheet.
      if (e.key === '?') {
        e.preventDefault();
        onToggleHelp();
        return;
      }

      // `⌘/Ctrl+A` selects all loaded photos — but only while selecting, so we
      // never steal the browser's select-all outside selection mode.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        if (selectionActive) {
          e.preventDefault();
          onSelectAll();
        }
        return;
      }

      // Bare `Esc` exits selection.
      if (e.key === 'Escape') {
        onEscape();
        return;
      }

      // `1`–`5` (no modifiers) switch view by on-screen position.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key >= '1' && e.key <= '5') {
        e.preventDefault();
        onSelectViewIndex(Number(e.key) - 1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, selectionActive, onToggleHelp, onSelectAll, onEscape, onSelectViewIndex]);
}
