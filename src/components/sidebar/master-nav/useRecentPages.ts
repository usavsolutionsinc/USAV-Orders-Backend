'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'sidebar.recentPages';
const MAX_RECENTS = 3;

/**
 * localStorage-backed "recent pages" for the master nav dropdown (plan D4).
 * Pins the last {@link MAX_RECENTS} distinct page ids, most-recent first, so the
 * operator can flick between the two or three pages they're actually working.
 * SSR-safe: starts empty, hydrates on mount.
 */
export function useRecentPages() {
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setRecents(parsed.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECENTS));
      }
    } catch {
      /* corrupt / unavailable storage — start empty */
    }
  }, []);

  const pushRecent = useCallback((pageId: string) => {
    if (!pageId || pageId === 'unknown') return;
    setRecents((prev) => {
      const next = [pageId, ...prev.filter((id) => id !== pageId)].slice(0, MAX_RECENTS);
      // No-op if unchanged (avoids a pointless write + render on every nav).
      if (next.length === prev.length && next.every((id, i) => id === prev[i])) return prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota / private-mode failures */
      }
      return next;
    });
  }, []);

  return { recents, pushRecent };
}
