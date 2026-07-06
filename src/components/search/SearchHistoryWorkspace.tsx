'use client';

/**
 * SearchHistoryWorkspace — the /search/history archive (docs/unified-global-
 * search-consolidation-plan.md §3.4, §9.2, decision D5).
 *
 * The canonical "all recent searches" view: full-width workbench body (no
 * sidebar), day-grouped, re-run / remove / clear. Reads the unified recents SoT
 * (useSearchRecents) so it stays in sync with the header dropdown. Re-run rows
 * are links to each entry's target (recentRerunHref) — global recents go to
 * /search?q=, contextual recents (later phases) to their own URL.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { History, Search, ChevronRight, X, Trash2 } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { PageHeader } from '@/components/ui/pane-header';
import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import { useSearchRecents } from '@/hooks/useSearchRecents';
import { resolveSearchScopeLabel } from '@/lib/search/search-scope-labels';
import { recentRerunHref, formatRelativeTime, groupRecentsByDay } from '@/lib/search/search-recents';
import { isUnifiedHeaderSearchEnabled } from '@/lib/search/unified-header-search';

export function SearchHistoryWorkspace() {
  const enabled = isUnifiedHeaderSearchEnabled();
  const { recents, remove, clear } = useSearchRecents({ migrateLegacy: enabled });
  const [scopeFilter, setScopeFilter] = useState<string>('all');

  // Distinct scopes present, for the filter rail (§Q1: filterable by scope).
  const scopeTabs = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of recents) {
      if (!seen.has(e.scope)) seen.set(e.scope, e.scopeLabel ?? resolveSearchScopeLabel(e.scope));
    }
    return [{ id: 'all', label: 'All' }, ...Array.from(seen, ([id, label]) => ({ id, label }))];
  }, [recents]);

  const filtered = useMemo(
    () => (scopeFilter === 'all' ? recents : recents.filter((e) => e.scope === scopeFilter)),
    [recents, scopeFilter],
  );

  const groups = useMemo(() => groupRecentsByDay(filtered), [filtered]);

  return (
    <>
      <PageHeader
        title="Recent searches"
        maxWidth="5xl"
        backHref="/search"
        rightSlot={
          recents.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => clear()}
              className="gap-1.5 text-caption font-semibold text-text-soft hover:text-rose-600"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear all
            </Button>
          ) : undefined
        }
      />
      <div className="mx-auto w-full max-w-5xl flex-1 space-y-4 overflow-y-auto px-6 py-4">
        <p className="text-caption font-medium text-text-soft">
          Re-run any past search — click a row, or edit it in the header search box.
        </p>

        {recents.length === 0 && (
          <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-10 text-center">
            <History className="mx-auto mb-2 h-6 w-6 text-text-faint" />
            <p className="text-sm font-semibold text-text-muted">No recent searches yet</p>
            <p className="text-caption font-medium text-text-soft">
              Queries you run from the header search box show up here so you never retype them.
            </p>
            <Link
              href="/search"
              className="mt-3 inline-flex text-caption font-semibold text-blue-600 hover:underline"
            >
              Search everything →
            </Link>
          </div>
        )}

        {scopeTabs.length > 2 && recents.length > 0 && (
          <HorizontalButtonSlider
            items={scopeTabs}
            value={scopeFilter}
            onChange={(id) => setScopeFilter(id)}
            variant="nav"
            dense
          />
        )}

        {groups.map((group) => (
          <section key={group.label} className="space-y-1">
            <p className="px-1 text-eyebrow font-black uppercase tracking-widest text-text-faint">
              {group.label}
            </p>
            <ul className="divide-y divide-border-hairline rounded-xl border border-border-hairline bg-surface-card">
              {group.entries.map((entry) => {
                const label = entry.scopeLabel ?? resolveSearchScopeLabel(entry.scope);
                return (
                  <li key={entry.id} className="group relative flex items-center">
                    <Link
                      href={recentRerunHref(entry)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left hover:bg-surface-hover"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                        <Search className="h-4 w-4 text-text-faint" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-caption font-bold text-text-default">
                          {entry.query}
                        </span>
                        <span className="text-eyebrow font-semibold uppercase tracking-widest text-text-soft">
                          {formatRelativeTime(entry.timestamp)}
                          {entry.resultCount != null ? ` · ${entry.resultCount} results` : ''}
                        </span>
                      </span>
                      <span className="hidden shrink-0 rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest ring-1 ring-inset ring-border-soft bg-surface-canvas text-text-muted sm:inline-flex">
                        {label}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                    <button
                      type="button"
                      aria-label={`Remove recent search “${entry.query}”`}
                      onClick={() => remove(entry.id)}
                      className="absolute right-2 flex h-6 w-6 items-center justify-center rounded-md text-text-faint opacity-0 transition-opacity hover:bg-surface-sunken hover:text-rose-600 group-hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
