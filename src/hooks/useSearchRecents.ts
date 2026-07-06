'use client';

/**
 * useSearchRecents — React binding over the unified recents SoT
 * (src/lib/search/search-recents.ts). Loads the list on mount, subscribes to
 * in-tab (`SEARCH_RECENTS_EVENT`) and cross-tab (`storage`) mutations so every
 * mounted consumer stays in sync, and re-exposes the store's mutators.
 *
 * `migrateLegacy` seeds the legacy per-domain buckets ONCE (non-destructive —
 * the sidebars still read their own keys during the transition). Pass it only
 * when the unified header search flag is on so a flag-off header is a true
 * no-op.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  listSearchRecents,
  pushSearchRecent,
  removeSearchRecent,
  clearSearchRecents,
  migrateLegacyRecents,
  SEARCH_RECENTS_EVENT,
  SEARCH_RECENTS_STORAGE_KEY,
  type SearchRecentEntry,
} from '@/lib/search/search-recents';

export interface UseSearchRecentsOptions {
  /** Filter to one scope key (e.g. `'global'`); omit for all. */
  scope?: string;
  /** Cap the returned list. */
  limit?: number;
  /** Seed legacy buckets once on mount (gate behind the rollout flag). */
  migrateLegacy?: boolean;
}

export function useSearchRecents(options: UseSearchRecentsOptions = {}) {
  const { scope, limit, migrateLegacy } = options;
  const [recents, setRecents] = useState<SearchRecentEntry[]>([]);

  const refresh = useCallback(() => {
    setRecents(listSearchRecents({ scope, limit }));
  }, [scope, limit]);

  useEffect(() => {
    if (migrateLegacy) migrateLegacyRecents();
    refresh();

    const onLocal = () => refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === SEARCH_RECENTS_STORAGE_KEY) refresh();
    };
    window.addEventListener(SEARCH_RECENTS_EVENT, onLocal);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SEARCH_RECENTS_EVENT, onLocal);
      window.removeEventListener('storage', onStorage);
    };
  }, [migrateLegacy, refresh]);

  const push = useCallback(
    (entry: Omit<SearchRecentEntry, 'id' | 'timestamp'> & { timestamp?: string }) =>
      pushSearchRecent(entry),
    [],
  );
  const remove = useCallback((id: string) => removeSearchRecent(id), []);
  const clear = useCallback((clearScope?: string) => clearSearchRecents(clearScope), []);

  return { recents, push, remove, clear, refresh };
}
