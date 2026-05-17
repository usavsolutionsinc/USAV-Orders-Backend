'use client';

import { useEffect } from 'react';

/**
 * Binds ⌘K / Ctrl+K to a toggle callback. Skips firing when the user is
 * typing in a text input, textarea, or contenteditable surface — so the
 * shortcut doesn't fight typing UX.
 */
export function useQuickAccessHotkey(enabled: boolean, onToggle: () => void): void {
  useEffect(() => {
    if (!enabled) return;

    const isEditableTarget = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable) return true;
      return false;
    };

    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== 'k') return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      onToggle();
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, onToggle]);
}
