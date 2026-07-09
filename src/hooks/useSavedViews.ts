'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * `useSavedViews` — the storage + URL-apply core extracted from
 * {@link import('@/components/sidebar/SavedViewsControl').SavedViewsControl} so
 * BOTH the legacy sidebar control and the new table ⋮ menu
 * ({@link import('@/components/ui/table-options/TableOptionsMenu').TableOptionsMenu})
 * share ONE implementation (station-table-unification-plan §3.2 refactor). A
 * "view" is a named, encoded subset of the surface's `paramKeys`; views persist
 * in localStorage and apply by writing those params into the URL, so an applied
 * view is shareable/bookmarkable.
 */
export interface SavedView {
  id: string;
  name: string;
  /** Encoded subset of the view's params (stable key order). */
  query: string;
}

export interface UseSavedViewsResult {
  views: SavedView[];
  /** Encoded current values of `paramKeys` (stable order) — for equality/save. */
  currentQuery: string;
  /** The saved view whose query matches the current URL, if any. */
  activeView: SavedView | null;
  /** True when at least one of the view's params is set in the URL. */
  hasActiveFilters: boolean;
  /** Apply a saved view: replace this surface's params with the view's, keep the rest. */
  applyView: (view: SavedView) => void;
  /** Save the current params under a name (replaces a same-name view). */
  saveView: (name: string) => void;
  /** Delete a saved view by id. */
  removeView: (id: string) => void;
}

export function useSavedViews({
  storageKey,
  paramKeys,
}: {
  storageKey: string;
  paramKeys: readonly string[];
}): UseSavedViewsResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [views, setViews] = useState<SavedView[]>([]);

  // Load + persist (tolerant of malformed storage, like RecentSearchesList).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setViews(raw ? (JSON.parse(raw) as SavedView[]) : []);
    } catch {
      setViews([]);
    }
  }, [storageKey]);

  const persist = useCallback(
    (next: SavedView[]) => {
      setViews(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* private mode / quota — keep in-memory */
      }
    },
    [storageKey],
  );

  // Encode only the params that define a view, in a stable order so equality is
  // reliable regardless of how they sit in the live URL.
  const currentQuery = useMemo(() => {
    const out = new URLSearchParams();
    for (const key of [...paramKeys].sort()) {
      const value = searchParams.get(key);
      if (value != null && value !== '') out.set(key, value);
    }
    return out.toString();
  }, [paramKeys, searchParams]);

  const hasActiveFilters = currentQuery.length > 0;
  const activeView = views.find((v) => v.query === currentQuery) ?? null;

  const applyView = useCallback(
    (view: SavedView) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const key of paramKeys) params.delete(key);
      const incoming = new URLSearchParams(view.query);
      incoming.forEach((value, key) => params.set(key, value));
      const qs = params.toString();
      router.replace(qs ? `${pathname || '/'}?${qs}` : pathname || '/', { scroll: false });
    },
    [paramKeys, searchParams, router, pathname],
  );

  const saveView = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const next: SavedView[] = [
        ...views.filter((v) => v.name.toLowerCase() !== trimmed.toLowerCase()),
        { id: `${Date.now().toString(36)}-${views.length}`, name: trimmed, query: currentQuery },
      ];
      persist(next);
    },
    [views, currentQuery, persist],
  );

  const removeView = useCallback((id: string) => persist(views.filter((v) => v.id !== id)), [views, persist]);

  return { views, currentQuery, activeView, hasActiveFilters, applyView, saveView, removeView };
}
