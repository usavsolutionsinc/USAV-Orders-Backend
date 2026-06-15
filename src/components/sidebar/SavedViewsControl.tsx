'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AnchoredLayer } from '@/design-system';
import { Star, Trash2, Check, Plus } from '@/components/Icons';

interface SavedView {
  id: string;
  name: string;
  /** Encoded subset of the view's params (stable key order). */
  query: string;
}

/**
 * Saved filter views — name and recall a combination of sidebar filters (stage,
 * sort, status-dot chip, type) so power users skip re-dialing the same set.
 *
 * Generic + mode-agnostic: the parent passes which `paramKeys` constitute a view
 * and a `storageKey`, so the SAME control serves Unshipped and Shipped. Views
 * persist in localStorage (same pattern as the sidebar's recent-search list) and
 * are URL-applied, so an applied view is shareable/bookmarkable.
 *
 * Visually quiet by design (per the project's flat, utilitarian system): a small
 * ghost trigger that opens a compact list — no loud chrome.
 */
export function SavedViewsControl({
  storageKey,
  paramKeys,
  label = 'Views',
}: {
  storageKey: string;
  paramKeys: readonly string[];
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [views, setViews] = useState<SavedView[]>([]);
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

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
      router.replace(qs ? `${pathname || '/dashboard'}?${qs}` : pathname || '/dashboard', { scroll: false });
      setOpen(false);
    },
    [paramKeys, searchParams, router, pathname],
  );

  const saveCurrent = useCallback(() => {
    const name = draftName.trim();
    if (!name) return;
    const next: SavedView[] = [
      ...views.filter((v) => v.name.toLowerCase() !== name.toLowerCase()),
      { id: `${Date.now().toString(36)}`, name, query: currentQuery },
    ];
    persist(next);
    setDraftName('');
    setNaming(false);
  }, [draftName, views, currentQuery, persist]);

  const removeView = useCallback(
    (id: string) => persist(views.filter((v) => v.id !== id)),
    [views, persist],
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-bold uppercase tracking-wide transition-colors ${
          activeView ? 'text-gray-900' : 'text-gray-500 hover:text-gray-900'
        }`}
        aria-expanded={open}
      >
        <Star className={`h-3.5 w-3.5 ${activeView ? 'text-amber-500' : 'text-gray-400'}`} />
        <span className="truncate max-w-[120px]">{activeView ? activeView.name : label}</span>
        {views.length > 0 ? <span className="tabular-nums text-gray-400">{views.length}</span> : null}
      </button>

      <AnchoredLayer open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} placement="bottom-start" gap={6}>
        <div className="w-60 rounded-xl border border-gray-200 bg-white py-1.5 shadow-lg">
          {views.length === 0 ? (
            <p className="px-3 py-2 text-xs italic text-gray-400">No saved views yet.</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-0.5">
              {views.map((view) => {
                const isActive = view.id === activeView?.id;
                return (
                  <li key={view.id} className="group flex items-center">
                    <button
                      type="button"
                      onClick={() => applyView(view)}
                      className={`flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-gray-50 ${
                        isActive ? 'font-semibold text-gray-900' : 'text-gray-700'
                      }`}
                    >
                      <Check className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-blue-600' : 'text-transparent'}`} />
                      <span className="truncate">{view.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeView(view.id)}
                      className="mr-1.5 shrink-0 rounded p-1 text-gray-300 opacity-0 transition-all hover:text-rose-500 group-hover:opacity-100"
                      aria-label={`Delete view ${view.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-1 border-t border-gray-100 pt-1.5">
            {naming ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveCurrent();
                }}
                className="flex items-center gap-1.5 px-2"
              >
                <input
                  ref={nameInputRef}
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Name this view…"
                  className="min-w-0 flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm outline-none focus:border-blue-400"
                />
                <button
                  type="submit"
                  disabled={!draftName.trim()}
                  className="shrink-0 rounded-md bg-gray-900 px-2 py-1 text-xs font-bold text-white transition-colors hover:bg-gray-800 disabled:bg-gray-300"
                >
                  Save
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setNaming(true)}
                disabled={!hasActiveFilters || Boolean(activeView)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
                title={
                  !hasActiveFilters
                    ? 'Set a filter first'
                    : activeView
                      ? 'These filters are already saved'
                      : 'Save the current filters as a view'
                }
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                Save current view
              </button>
            )}
          </div>
        </div>
      </AnchoredLayer>
    </>
  );
}
