'use client';

/**
 * SearchWorkspace — the /search results page body (see src/app/search/page.tsx
 * header for the contract). Thin wrapper: owns the URL state (?q= / ?type=) and
 * renders the shared <SearchResultsSurface> which owns retrieval + result
 * rendering (same body operations history reuses).
 *
 * There is ONE search input: the global header pill, registered here in
 * CONTEXTUAL mode (usePageHeaderSearch) so it live-drives ?q= while the user is
 * on /search — the page no longer renders its own field (that was the duplicate
 * bar). This mirrors how operations history binds the header, and keeps the AI
 * assistant toggle (which lives inside the header pill) available on /search.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/pane-header';
import { SearchResultsSurface } from '@/components/search/SearchResultsSurface';
import { isTabId, type TabId } from '@/components/search/search-tabs';
import { usePageHeaderSearch } from '@/hooks/usePageHeader';

export function SearchWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = (searchParams.get('q') ?? '').trim();
  const rawType = (searchParams.get('type') ?? 'all').toLowerCase();
  const tab: TabId = isTabId(rawType) ? rawType : 'all';

  const [input, setInput] = useState(q);
  const [surfaceBusy, setSurfaceBusy] = useState(false);

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

  // The global header pill IS the /search input while this page is mounted.
  usePageHeaderSearch(
    {
      value: input,
      onChange: (value) => {
        setInput(value);
        updateUrl({ q: value.trim() });
      },
      onClear: () => {
        setInput('');
        updateUrl({ q: '' });
      },
      placeholder: 'Search orders, serials, cartons, SKUs, repairs, FBA…',
      debounceMs: 250,
      isSearching: surfaceBusy,
    },
    [input, surfaceBusy],
  );

  return (
    <>
      <PageHeader title="Search" maxWidth="5xl" />
      <div className="mx-auto w-full max-w-5xl flex-1 space-y-4 overflow-y-auto px-6 py-4">
        <SearchResultsSurface
          scope="global"
          query={q}
          activeTab={tab}
          onTabChange={(t) => updateUrl({ type: t })}
          onLoadingChange={setSurfaceBusy}
        />
      </div>
    </>
  );
}
