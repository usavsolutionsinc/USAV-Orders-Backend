'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { Phone } from '@/components/Icons';
import { EmptyState } from '@/design-system/primitives';
import { TimelineSection } from '@/components/ui/TimelineSection';
import { callEventsToTimeline } from '@/lib/timeline';
import {
  parseCallDirection,
  CALL_DIRECTION_ITEMS,
} from '@/components/sidebar/support/support-sidebar-shared';
import { isNotConfigured, useCallEvents } from './useVoiceQueries';

/**
 * Calls mode — the Monitor body. A newest-first org call stream rendered through
 * the shared {@link EventTimeline} (via `callEventsToTimeline`), reacting to the
 * ephemeral `?direction=` / `?q=` URL filters set by the sidebar rail. Read-only:
 * no durable selection, no edit.
 */
export function CallLogView() {
  const searchParams = useSearchParams();
  const direction = parseCallDirection(searchParams.get('direction'));
  const query = searchParams.get('q') ?? '';

  const { data, isLoading, error } = useCallEvents({ direction, query: query.trim() });
  const notConfigured = isNotConfigured(error);

  const items = useMemo(() => callEventsToTimeline(data?.items ?? []), [data?.items]);

  const directionLabel = CALL_DIRECTION_ITEMS.find((d) => d.id === direction)?.label ?? 'All';

  if (notConfigured) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={<Phone className="h-6 w-6 text-gray-400" />}
          title="Call log isn’t connected"
          description="Connect Nextiva in Settings → Integrations to watch inbound, outbound, and missed calls stream in here."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center">
          <p className="text-caption font-semibold text-rose-700">Could not load the call log.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto h-full w-full max-w-3xl overflow-y-auto px-6 py-6">
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-black uppercase tracking-tighter text-gray-900">Call log</h1>
        <p className="text-eyebrow font-bold uppercase tracking-widest text-blue-600">
          {directionLabel} · live
        </p>
      </header>
      <TimelineSection
        title="Calls"
        loading={isLoading}
        items={items}
        emptyMessage={query ? 'No calls match this search.' : 'No calls recorded yet.'}
        className="border-t border-gray-100 pt-4"
      />
    </div>
  );
}
