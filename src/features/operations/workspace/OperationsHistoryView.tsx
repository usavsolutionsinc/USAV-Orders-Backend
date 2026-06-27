'use client';

/**
 * Operations → History mode: the Master Operations Journey, as a RECORD LOOKUP.
 *
 * The right panel never shows a loose firehose of all events — it stays empty
 * until you paste an order / serial / tracking number in the sidebar, then it
 * renders THAT record's complete event timeline across every station
 * (receiving → tested → packed → shipped → carrier → returned/warranty),
 * aggregated from all five spines. The record number renders as a last-4
 * copy chip. Monitor archetype: observe-only, URL-driven, no edit affordances,
 * one shared `EventTimeline` primitive.
 */

import { useState } from 'react';
import { Download, FileText, History, Loader2, X } from '@/components/Icons';
import { OrderIdChip, SerialChip, TrackingChip, getLast4 } from '@/components/ui/CopyChip';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { TimelineSection } from '@/components/ui/TimelineSection';
import { IdentifierToggle } from '@/components/ui/IdentifierToggle';
import type { TimelineGroupMode } from '@/components/ui/EventTimeline';
import { journeyKeyOf, type JourneyDimension } from '@/lib/timeline/journey';
import { downloadJourneyCsv, printJourney } from '@/lib/serial/serial-journey';
import { useOperationsTimelineUrlState } from '@/components/sidebar/operations/useOperationsTimelineUrlState';
import { useOperationsJourney } from '@/hooks/useOperationsJourney';

const DIM_LABEL: Record<JourneyDimension, string> = {
  order: 'Order',
  serial: 'Serial',
  tracking: 'Tracking',
};

const FOCUSED_TOGGLE_OPTIONS: ReadonlyArray<{ value: TimelineGroupMode; label: string }> = [
  { value: 'time', label: 'Timeline' },
  { value: 'serial', label: 'By unit' },
];

/** The looked-up record number, rendered as a last-4 CopyChip per dimension. */
function RecordChip({ dim, value }: { dim: JourneyDimension; value: string }) {
  const v = value.trim();
  if (!v) return null;
  if (dim === 'serial') return <SerialChip value={v} display={getLast4(v)} width="w-auto" dense />;
  if (dim === 'tracking') return <TrackingChip value={v} display={getLast4(v)} dense />;
  return <OrderIdChip value={v} display={getLast4(v)} dense />;
}

export function OperationsHistoryView() {
  const url = useOperationsTimelineUrlState();
  const journey = useOperationsJourney(url);
  const [focusedMode, setFocusedMode] = useState<TimelineGroupMode>('time');

  const { focused, items, groupOf, entity } = journey;
  const dimLabel = DIM_LABEL[url.dim];
  const eventCount = items.length;
  const showUnitToggle = (entity?.serials.length ?? 0) > 1;

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
                {focused ? `${dimLabel} record` : 'Operations record'}
              </h1>
              <div className="mt-1 flex items-center gap-1.5">
                {focused ? (
                  <>
                    <RecordChip dim={url.dim} value={url.entityValue} />
                    <button
                      type="button"
                      onClick={() => url.setEntity('')}
                      className="inline-flex items-center gap-0.5 text-eyebrow font-bold uppercase tracking-widest text-gray-400 hover:text-gray-600"
                      aria-label="Clear record"
                    >
                      <X className="h-3 w-3" /> Clear
                    </button>
                  </>
                ) : (
                  <p className="text-eyebrow font-bold uppercase tracking-widest text-gray-500">
                    Paste a record number to begin
                  </p>
                )}
              </div>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
          {!focused ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-12 text-center">
              <History className="mx-auto h-7 w-7 text-gray-300" />
              <p className="mt-3 text-caption font-semibold text-gray-700">
                Paste a record number to see its complete timeline
              </p>
              <p className="mt-1 text-micro leading-5 text-gray-400">
                Search an order, serial, or tracking number in the sidebar — its full journey across
                every station appears here.
              </p>
            </div>
          ) : journey.isError ? (
            <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-10 text-center">
              <p className="text-caption font-semibold text-rose-600">
                No record found for this {url.dim} number.
              </p>
              <button
                type="button"
                onClick={() => journey.refetch()}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-caption font-semibold text-rose-600 hover:bg-rose-50"
              >
                <Loader2 className="h-3.5 w-3.5" /> Retry
              </button>
            </div>
          ) : (
            <TimelineSection
              title="Record timeline"
              loading={journey.isLoading}
              items={items}
              groupMode={focusedMode}
              groupKeyOf={focusedMode === 'serial' ? journeyKeyOf('serial', groupOf) : undefined}
              richTime
              emptyMessage="No events recorded for this record yet."
              className=""
              headerRight={
                !journey.isLoading && items.length > 0 ? (
                  <div className="flex items-center gap-2">
                    {showUnitToggle ? (
                      <IdentifierToggle
                        value={focusedMode}
                        onChange={setFocusedMode}
                        options={FOCUSED_TOGGLE_OPTIONS}
                        ariaLabel="Record grouping"
                      />
                    ) : null}
                    <HoverTooltip label="Export CSV">
                      <button
                        type="button"
                        onClick={() => downloadJourneyCsv(url.entityValue, items)}
                        aria-label="Export CSV"
                        className="-my-0.5 inline-flex items-center rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    </HoverTooltip>
                    <HoverTooltip label="Print / Save as PDF">
                      <button
                        type="button"
                        onClick={() => printJourney(url.entityValue, items)}
                        aria-label="Print or save as PDF"
                        className="-my-0.5 inline-flex items-center rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                      >
                        <FileText className="h-3.5 w-3.5" />
                      </button>
                    </HoverTooltip>
                    <span className="ml-1 tabular-nums">
                      {eventCount.toLocaleString()} event{eventCount === 1 ? '' : 's'}
                    </span>
                  </div>
                ) : undefined
              }
            />
          )}
        </section>
      </main>
    </div>
  );
}
