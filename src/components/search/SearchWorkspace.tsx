'use client';

/**
 * SearchWorkspace — the /search results page body (see src/app/search/page.tsx
 * header for the contract). Client component: reads ?q= / ?type=, queries
 * /api/ai/retrieve, renders Overview (grouped categories) or a single
 * category, all through the shared SearchHit row renderer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Loader2 } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { SearchField } from '@/design-system/primitives/SearchField';
import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { PageHeader } from '@/components/ui/pane-header';
import { AiQuickJumpResults } from '@/components/search/AiQuickJumpResults';
import type { AiSearchHit } from '@/lib/search/ai-search-client';

// UI entityType → tab metadata. 'all' is the Overview.
const CATEGORY_TABS = [
  { id: 'all', label: 'Overview' },
  { id: 'order', label: 'Orders', db: 'ORDER' },
  { id: 'unit', label: 'Units', db: 'SERIAL_UNIT' },
  { id: 'receiving', label: 'Receiving', db: 'RECEIVING' },
  { id: 'sku', label: 'SKUs', db: 'SKU' },
  { id: 'repair', label: 'Repairs', db: 'REPAIR' },
  { id: 'fba', label: 'FBA', db: 'FBA_SHIPMENT' },
] as const;

type TabId = (typeof CATEGORY_TABS)[number]['id'];

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORY_TABS.filter((t) => t.id !== 'all').map((t) => [t.id, t.label]),
);

interface FetchState {
  status: 'idle' | 'loading' | 'done' | 'forbidden' | 'error';
  hits: AiSearchHit[];
  usedSemantic: boolean;
  forKey: string;
}

export function SearchWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = (searchParams.get('q') ?? '').trim();
  const rawType = (searchParams.get('type') ?? 'all').toLowerCase();
  const tab: TabId = CATEGORY_TABS.some((t) => t.id === rawType) ? (rawType as TabId) : 'all';

  const [input, setInput] = useState(q);
  const [state, setState] = useState<FetchState>({
    status: 'idle',
    hits: [],
    usedSemantic: false,
    forKey: '',
  });
  const abortRef = useRef<AbortController | null>(null);

  // Keep the input in sync when the URL changes externally (⌘K handoff).
  useEffect(() => {
    setInput(q);
  }, [q]);

  const updateUrl = useCallback(
    (next: { q?: string; type?: TabId }) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (next.q !== undefined) {
        if (next.q) sp.set('q', next.q);
        else sp.delete('q');
      }
      if (next.type !== undefined) {
        if (next.type === 'all') sp.delete('type');
        else sp.set('type', next.type);
      }
      router.replace(`/search?${sp.toString()}`);
    },
    [router, searchParams],
  );

  // One fetch per (q, tab): Overview pulls a wide cross-entity page; a
  // category tab re-queries with the HARD entityTypes scope so its list is
  // deep, not the overview leftovers.
  useEffect(() => {
    const key = `${q}::${tab}`;
    if (!q || q.length < 2) {
      setState({ status: 'idle', hits: [], usedSemantic: false, forKey: key });
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((prev) => ({ ...prev, status: 'loading', forKey: key }));

    const dbType = CATEGORY_TABS.find((t) => t.id === tab && t.id !== 'all') as
      | { db: string }
      | undefined;

    fetch('/api/ai/retrieve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: q,
        limit: 50,
        pageContext: '/search',
        entityTypes: dbType ? [dbType.db] : undefined,
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
  }, [q, tab]);

  // Overview: group by entityType, category order fixed by the tab list.
  const grouped = useMemo(() => {
    const byType = new Map<string, AiSearchHit[]>();
    for (const hit of state.hits) {
      const list = byType.get(hit.entityType) ?? [];
      list.push(hit);
      byType.set(hit.entityType, list);
    }
    return CATEGORY_TABS.filter((t) => t.id !== 'all')
      .map((t) => ({ id: t.id as string, label: t.label, hits: byType.get(t.id) ?? [] }))
      .filter((g) => g.hits.length > 0);
  }, [state.hits]);

  const showResults = state.status === 'done' && state.hits.length > 0;

  return (
    <>
      <PageHeader title="Search" maxWidth="5xl" />
      <div className="mx-auto w-full max-w-5xl flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {/* Query input — URL is the state; Enter/debounce commits ?q= */}
        <SearchField
          value={input}
          onChange={(value) => {
            setInput(value);
            updateUrl({ q: value.trim() });
          }}
          placeholder="Search orders, serials, cartons, SKUs, repairs, FBA…"
          isSearching={state.status === 'loading'}
          autoFocus
        />

        {/* Category tabs */}
        <HorizontalButtonSlider
          items={CATEGORY_TABS.map((t) => ({ id: t.id, label: t.label }))}
          value={tab}
          onChange={(id) => updateUrl({ type: id as TabId })}
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
            {tab !== 'all' ? ` in ${CATEGORY_LABELS[tab] ?? tab}` : ''}. Try fewer words, a partial
            serial, or the last 8 digits of a tracking number.
          </div>
        )}

        {/* Overview: grouped categories with View-all handoff */}
        {showResults && tab === 'all' && (
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
                      onClick={() => updateUrl({ type: group.id as TabId })}
                      className="-my-1.5 px-1 text-caption font-semibold text-blue-600 hover:bg-transparent hover:underline"
                    >
                      View all →
                    </Button>
                  )}
                </div>
                <AiQuickJumpResults hits={group.hits.slice(0, 5)} className="[&>p]:hidden" />
              </section>
            ))}
          </div>
        )}

        {/* Single category: the full scoped list */}
        {showResults && tab !== 'all' && (
          <div className="rounded-xl border border-border-hairline bg-surface-card pb-2">
            <AiQuickJumpResults hits={state.hits} className="[&>p]:hidden" />
          </div>
        )}
      </div>
    </>
  );
}
