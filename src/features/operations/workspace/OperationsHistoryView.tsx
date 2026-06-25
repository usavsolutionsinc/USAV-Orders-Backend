'use client';

/**
 * Operations → History mode: the Master Operations Journey.
 *
 * Never a loose firehose — it renders a timeline PER order / serial / tracking
 * number, showing the stations and points each one hit along the process:
 *   • FOCUSED (a serial/order/tracking in the URL) → that entity's complete
 *     cross-station journey, chronological (optionally re-grouped by unit).
 *   • BROWSE (no entity) → recent activity as per-entity journey bands, paged.
 *
 * Aggregates all five spines (SAL + inventory + audit + carrier + warranty) via
 * `useOperationsJourney`, and renders through the shared `EventTimeline`
 * primitive (Monitor archetype — observe-only, URL-driven, no edit affordances).
 */

import { useEffect, useRef, useState } from 'react';
import { History, Loader2, X } from '@/components/Icons';
import { TimelineSection } from '@/components/ui/TimelineSection';
import { IdentifierToggle } from '@/components/ui/IdentifierToggle';
import type { TimelineGroupMode } from '@/components/ui/EventTimeline';
import { journeyKeyOf } from '@/lib/timeline/journey';
import { useOperationsTimelineUrlState } from '@/components/sidebar/operations/useOperationsTimelineUrlState';
import { useOperationsJourney } from '@/hooks/useOperationsJourney';

const DIM_LABEL: Record<string, string> = { order: 'Order', serial: 'Serial', tracking: 'Tracking' };

const FOCUSED_TOGGLE_OPTIONS: ReadonlyArray<{ value: TimelineGroupMode; label: string }> = [
  { value: 'time', label: 'Timeline' },
  { value: 'serial', label: 'By unit' },
];

/** IntersectionObserver sentinel — fires `onIntersect` when scrolled into view. */
function InfiniteSentinel({ onIntersect, disabled }: { onIntersect: () => void; disabled: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cbRef = useRef(onIntersect);
  cbRef.current = onIntersect;

  useEffect(() => {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) cbRef.current();
      },
      { rootMargin: '320px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [disabled]);

  return <div ref={ref} aria-hidden className="h-4 w-full" />;
}

export function OperationsHistoryView() {
  const url = useOperationsTimelineUrlState();
  const journey = useOperationsJourney(url);
  const [focusedMode, setFocusedMode] = useState<TimelineGroupMode>('time');

  const { focused, items, groupOf, entity } = journey;
  const dimLabel = DIM_LABEL[url.dim] ?? 'Order';
  const eventCount = items.length;

  // Band bucketing: focused = one entity (time, or "by unit" via serial keys);
  // browse = one band per order/serial/tracking (the active dimension).
  const groupMode: TimelineGroupMode = focused ? focusedMode : 'serial';
  const groupKeyOf =
    focused
      ? focusedMode === 'serial'
        ? journeyKeyOf('serial', groupOf)
        : undefined
      : journeyKeyOf(url.dim, groupOf);

  const showFocusedToggle = focused && (entity?.serials.length ?? 0) > 1;
  const isEmpty = !journey.isLoading && items.length === 0;

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto bg-gray-50 text-gray-900">
      <main className="flex-1 w-full max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-16 space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/10 text-blue-600">
              <History className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-gray-900 leading-none">
                {focused ? `${dimLabel} journey` : 'Operations journey'}
              </h1>
              <p className="mt-1 flex items-center gap-1.5 text-eyebrow font-bold uppercase tracking-widest text-gray-500">
                {focused ? (
                  <>
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700 ring-1 ring-inset ring-blue-200 normal-case tracking-normal">
                      {url.entityValue}
                    </span>
                    <button
                      type="button"
                      onClick={() => url.setEntity('')}
                      className="inline-flex items-center gap-0.5 text-gray-400 hover:text-gray-600"
                      aria-label="Clear focused entity"
                    >
                      <X className="h-3 w-3" /> Clear
                    </button>
                  </>
                ) : (
                  <span>
                    By {url.dim} · {eventCount.toLocaleString()} event{eventCount === 1 ? '' : 's'}
                    {url.activeFilterCount > 0 ? ` · ${url.activeFilterCount} filter${url.activeFilterCount === 1 ? '' : 's'}` : ''}
                  </span>
                )}
              </p>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
          {journey.isError && focused ? (
            <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-8 text-center">
              <p className="text-caption font-semibold text-rose-600">
                No journey found for this {url.dim}.
              </p>
              <button
                type="button"
                onClick={() => journey.refetch()}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-caption font-semibold text-rose-600 hover:bg-rose-50"
              >
                <Loader2 className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          ) : journey.isError ? (
            <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-8 text-center text-caption font-semibold text-rose-600">
              Could not load the operations journey.
            </div>
          ) : isEmpty && !focused && url.activeFilterCount === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-10 text-center">
              <History className="mx-auto h-6 w-6 text-gray-300" />
              <p className="mt-2 text-caption font-semibold text-gray-600">
                Search a serial, order, or tracking number
              </p>
              <p className="mt-1 text-micro text-gray-400">
                See its complete journey across every station — or browse recent activity here.
              </p>
            </div>
          ) : (
            <TimelineSection
              title={focused ? 'Journey' : 'Recent journeys'}
              loading={journey.isLoading}
              items={items}
              groupMode={groupMode}
              groupKeyOf={groupKeyOf}
              emptyMessage={
                url.activeFilterCount > 0 || focused
                  ? 'No operations match this filter.'
                  : 'No recent operations.'
              }
              className=""
              headerRight={
                !journey.isLoading && items.length > 0 ? (
                  <div className="flex items-center gap-3">
                    {showFocusedToggle ? (
                      <IdentifierToggle
                        value={focusedMode}
                        onChange={setFocusedMode}
                        options={FOCUSED_TOGGLE_OPTIONS}
                        ariaLabel="Journey grouping"
                      />
                    ) : null}
                    <span>{eventCount.toLocaleString()} events</span>
                  </div>
                ) : undefined
              }
            />
          )}

          {/* Browse pagination */}
          {!focused && !journey.isError ? (
            <>
              <InfiniteSentinel
                onIntersect={() => journey.fetchNextPage()}
                disabled={!journey.hasNextPage || journey.isFetchingNextPage}
              />
              {journey.isFetchingNextPage ? (
                <div className="flex items-center justify-center gap-2 py-3 text-caption font-semibold text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading more…
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}
