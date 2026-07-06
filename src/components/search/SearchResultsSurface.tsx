'use client';

/**
 * SearchResultsSurface — the shared results body for /search AND
 * /operations?mode=history. Extracted out of SearchWorkspace so both surfaces
 * render identically (SoT: one surface, never a per-page search body).
 *
 * Controlled: the host owns the query + active tab (URL state) and passes them
 * in; the surface owns only the retrieval + result rendering. `scope` drives
 * the tab order (operations = orders-first), the pageContext, and — via
 * `onSelectHit` — whether a row navigates (default `<Link>`) or the host
 * intercepts it (operations drills into the record timeline in-page).
 */

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Search, Loader2 } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { AiQuickJumpResults } from '@/components/search/AiQuickJumpResults';
import type { AiSearchHit } from '@/lib/search/ai-search-client';
import { cn } from '@/utils/_cn';
import {
  CATEGORY_LABELS,
  CATEGORY_TABS,
  orderedTabsForScope,
  tabDbType,
  type SearchScope,
  type TabId,
} from './search-tabs';

export interface SearchResultsSurfaceProps {
  query: string;
  scope: SearchScope;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  /**
   * Row click. Receives the event so a host can intercept the `<Link>` (e.g.
   * operations drills in-page via event.preventDefault()). When absent, rows
   * navigate to their deep-link normally.
   */
  onSelectHit?: (hit: AiSearchHit, event: ReactMouseEvent) => void;
  /**
   * Fires when the in-flight state changes, so a host (operations) can reflect
   * it on the header pill's spinner. `/search` ignores it (its own field shows
   * the state).
   */
  onLoadingChange?: (loading: boolean) => void;
  className?: string;
}

interface FetchState {
  status: 'idle' | 'loading' | 'done' | 'forbidden' | 'error';
  hits: AiSearchHit[];
  usedSemantic: boolean;
  forKey: string;
}

const GROUPS = CATEGORY_TABS.filter((t) => t.id !== 'all');

export function SearchResultsSurface({
  query,
  scope,
  activeTab,
  onTabChange,
  onSelectHit,
  onLoadingChange,
  className,
}: SearchResultsSurfaceProps) {
  const q = query.trim();
  const [state, setState] = useState<FetchState>({
    status: 'idle',
    hits: [],
    usedSemantic: false,
    forKey: '',
  });
  const abortRef = useRef<AbortController | null>(null);
  const pageContext = scope === 'operations' ? '/operations' : '/search';

  // One fetch per (q, tab): Overview pulls a wide cross-entity page; a category
  // tab re-queries with the HARD entityTypes scope so its list is deep.
  useEffect(() => {
    const key = `${q}::${activeTab}`;
    if (!q || q.length < 2) {
      setState({ status: 'idle', hits: [], usedSemantic: false, forKey: key });
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((prev) => ({ ...prev, status: 'loading', forKey: key }));

    const dbType = tabDbType(activeTab);

    fetch('/api/ai/retrieve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: q,
        limit: 50,
        pageContext,
        entityTypes: dbType ? [dbType] : undefined,
      }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (controller.signal.aborted) return;
        if (res.status === 403) {
          setState({ status: 'forbidden', hits: [], usedSemantic: false, forKey: key });
          return;
        }
        if (!res.ok) throw new Error(`search failed (${res.status})`);
        const data = await res.json();
        setState({
          status: 'done',
          hits: data.hits ?? [],
          usedSemantic: Boolean(data.usedSemantic),
          forKey: key,
        });
      })
      .catch((err) => {
        if ((err as { name?: string }).name === 'AbortError') return;
        setState({ status: 'error', hits: [], usedSemantic: false, forKey: key });
      });
  }, [q, activeTab, pageContext]);

  // Surface the in-flight state to the host (operations header spinner). Reset
  // to idle on unmount so a drilled-away pane never leaves the pill spinning.
  useEffect(() => {
    onLoadingChange?.(state.status === 'loading');
  }, [state.status, onLoadingChange]);
  useEffect(() => () => onLoadingChange?.(false), [onLoadingChange]);

  // Overview: group by entityType in the fixed category order.
  const grouped = useMemo(() => {
    const byType = new Map<string, AiSearchHit[]>();
    for (const hit of state.hits) {
      const list = byType.get(hit.entityType) ?? [];
      list.push(hit);
      byType.set(hit.entityType, list);
    }
    return GROUPS.map((t) => ({ id: t.id as string, label: t.label, hits: byType.get(t.id) ?? [] })).filter(
      (g) => g.hits.length > 0,
    );
  }, [state.hits]);

  const showResults = state.status === 'done' && state.hits.length > 0;
  const tabs = orderedTabsForScope(scope);

  return (
    <div className={cn('space-y-4', className)}>
      <HorizontalButtonSlider
        items={tabs.map((t) => ({ id: t.id, label: t.label }))}
        value={activeTab}
        onChange={(id) => onTabChange(id as TabId)}
        variant="nav"
        dense
      />

      {state.status === 'done' && (
        <p className="text-caption font-medium text-text-soft">
          {state.hits.length === 50 ? '50+' : state.hits.length} result
          {state.hits.length === 1 ? '' : 's'} for “{q}”
          {state.usedSemantic ? ' · semantic + keyword' : ' · keyword'}
        </p>
      )}

      {/* States */}
      {!q && (
        <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-10 text-center">
          <Search className="mx-auto mb-2 h-6 w-6 text-text-faint" />
          <p className="text-sm font-semibold text-text-muted">Search everything, from anywhere</p>
          <p className="text-caption font-medium text-text-soft">
            Orders, serial units, receiving cartons, SKUs, repairs and FBA shipments — one query.
          </p>
        </div>
      )}
      {state.status === 'loading' && !showResults && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-soft">
          <Loader2 className="h-4 w-4 animate-spin" /> Searching…
        </div>
      )}
      {state.status === 'forbidden' && (
        <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center text-caption font-medium text-rose-700">
          Your role doesn’t include AI search yet — ask an admin to grant the “AI search
          retrieval” permission.
        </div>
      )}
      {state.status === 'error' && (
        <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center text-caption font-medium text-rose-700">
          Search failed — try again.
        </div>
      )}
      {state.status === 'done' && state.hits.length === 0 && q && (
        <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-6 text-center text-caption font-medium text-text-soft">
          No matches for “{q}”
          {activeTab !== 'all' ? ` in ${CATEGORY_LABELS[activeTab] ?? activeTab}` : ''}. Try fewer
          words, a partial serial, or the last 8 digits of a tracking number.
        </div>
      )}

      {/* Overview: grouped categories with View-all handoff */}
      {showResults && activeTab === 'all' && (
        <div className="space-y-4 pb-8">
          {grouped.map((group) => (
            <section key={group.id} className="rounded-xl border border-border-hairline bg-surface-card">
              <div className="flex items-center justify-between border-b border-border-hairline px-3 py-2">
                <p className="text-eyebrow font-black uppercase tracking-widest text-text-soft">
                  {group.label}
                  <span className="ml-1.5 rounded bg-surface-sunken px-1.5 py-0.5 text-text-soft">
                    {group.hits.length}
                  </span>
                </p>
                {group.hits.length > 5 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onTabChange(group.id as TabId)}
                    className="-my-1.5 px-1 text-caption font-semibold text-blue-600 hover:bg-transparent hover:underline"
                  >
                    View all →
                  </Button>
                )}
              </div>
              <AiQuickJumpResults
                hits={group.hits.slice(0, 5)}
                onNavigate={onSelectHit}
                className="[&>p]:hidden"
              />
            </section>
          ))}
        </div>
      )}

      {/* Single category: the full scoped list */}
      {showResults && activeTab !== 'all' && (
        <div className="rounded-xl border border-border-hairline bg-surface-card pb-2">
          <AiQuickJumpResults hits={state.hits} onNavigate={onSelectHit} className="[&>p]:hidden" />
        </div>
      )}
    </div>
  );
}
