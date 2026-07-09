'use client';

/**
 * Signals ▸ Timeline — Monitor surface (universal-feed plan Phase 5). Org-scoped,
 * newest-first `entity_signals` timeline. Filters live in the Operations sidebar;
 * search is registered with the global header (`?q=`).
 */

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { TimelineSection } from '@/components/ui/TimelineSection';
import { entitySignalsToTimeline, type EntitySignalTimelineRow } from '@/lib/timeline';

const WINDOWS: Array<{ id: string; label: string; days: number | null }> = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: 'all', label: 'All time', days: null },
];

export function SignalsHistoryWorkspace() {
  const searchParams = useSearchParams();

  const windowId = searchParams.get('window') ?? '30d';
  const kind = searchParams.get('signalKind') ?? '';
  const q = searchParams.get('q') ?? '';
  const activeWindow = WINDOWS.find((w) => w.id === windowId) ?? WINDOWS[1];
  const sinceDays = activeWindow.days;

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
