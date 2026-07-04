'use client';

/**
 * Signals ▸ History — a Monitor surface (universal-feed plan Phase 5). Org-scoped,
 * newest-first `entity_signals` timeline: the "why" behind outcomes (returns,
 * test fails, receiving exceptions, denials, buyer notes). Read-only; every
 * filter is an ephemeral URL param (Monitor rule), data flows in via a polled
 * query with a staleTime (no refetch loop).
 *
 * Reuses the shared timeline primitive: a `*ToTimeline` adapter
 * (entitySignalsToTimeline) → TimelineSection. No second timeline component.
 */

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { TimelineSection } from '@/components/ui/TimelineSection';
import { entitySignalsToTimeline, type EntitySignalTimelineRow } from '@/lib/timeline';
import { SIGNAL_KIND_LIST, SIGNAL_KINDS } from '@/lib/surfaces/registry';

const WINDOWS: Array<{ id: string; label: string; days: number | null }> = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: 'all', label: 'All time', days: null },
];

const SELECT_CLASS =
  'rounded-md border border-border-soft bg-surface-card px-2 py-1 text-caption font-semibold text-text-muted focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400';

export function SignalsHistoryWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const windowId = searchParams.get('window') ?? '30d';
  const kind = searchParams.get('signalKind') ?? '';
  const q = searchParams.get('q') ?? '';
  // Distinguish "not found" from a legitimate null (the 'all' window has
  // days=null): a bare `?.days ?? 30` would turn "All time" into 30 days.
  const activeWindow = WINDOWS.find((w) => w.id === windowId) ?? WINDOWS[1]; // default: 30 days
  const sinceDays = activeWindow.days;

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      const qs = next.toString();
      router.replace(qs ? `/signals?${qs}` : '/signals', { scroll: false });
    },
    [router, searchParams],
  );

  const { data, isLoading } = useQuery<EntitySignalTimelineRow[]>({
    queryKey: ['entity-signals', windowId, kind, q],
    staleTime: 30_000,
    queryFn: async () => {
      const sp = new URLSearchParams({ limit: '200' });
      if (sinceDays != null) sp.set('sinceDays', String(sinceDays));
      if (kind) sp.set('signalKind', kind);
      if (q.trim()) sp.set('q', q.trim());
      const res = await fetch(`/api/entity-signals?${sp.toString()}`, { cache: 'no-store' });
      if (!res.ok) return [];
      const body = (await res.json().catch(() => null)) as { signals?: EntitySignalTimelineRow[] } | null;
      return body?.signals ?? [];
    },
  });

  const items = useMemo(() => entitySignalsToTimeline(data ?? []), [data]);
  const emptyMessage = q || kind ? 'No signals match this filter.' : 'No signals recorded yet.';

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 p-4">
      <div className="space-y-1">
        <h1 className="text-lg font-black tracking-tight text-text-default">Signals · History</h1>
        <p className="text-caption text-text-soft">
          Why outcomes happened — returns, test fails, receiving exceptions, denials, buyer notes.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className={SELECT_CLASS}
          value={windowId}
          onChange={(e) => setParam('window', e.target.value === '30d' ? '' : e.target.value)}
          aria-label="Time window"
        >
          {WINDOWS.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLASS}
          value={kind}
          onChange={(e) => setParam('signalKind', e.target.value)}
          aria-label="Signal kind"
        >
          <option value="">All kinds</option>
          {SIGNAL_KIND_LIST.map((k) => (
            <option key={k} value={k}>
              {SIGNAL_KINDS[k].label}
            </option>
          ))}
        </select>
        <input
          className={`${SELECT_CLASS} flex-1`}
          type="search"
          placeholder="Search notes…"
          defaultValue={q}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setParam('q', (e.target as HTMLInputElement).value);
          }}
          onBlur={(e) => setParam('q', e.target.value)}
          aria-label="Search signal notes"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <TimelineSection
          title="Signals"
          items={items}
          loading={isLoading}
          emptyMessage={emptyMessage}
          richTime
          headerRight={<span className="text-eyebrow font-black uppercase tracking-widest text-text-faint">{items.length}</span>}
        />
      </div>
    </div>
  );
}
