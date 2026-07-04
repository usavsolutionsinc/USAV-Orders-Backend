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

import { useMemo, useState } from 'react';
import { Download, FileText, History, Loader2, X } from '@/components/Icons';
import { OrderIdChip, SerialChip, TrackingChip, getLast4 } from '@/components/ui/CopyChip';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { TimelineSection } from '@/components/ui/TimelineSection';
import { Button, IconButton } from '@/design-system/primitives';
import { IdentifierToggle } from '@/components/ui/IdentifierToggle';
import { SerialProvenanceHeader } from '@/components/operations/SerialProvenanceHeader';
import type { TimelineGroupMode } from '@/components/ui/EventTimeline';
import type { SerialProvenance } from '@/lib/queries/operations-journey-queries';
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
  const totalSerials = entity?.serials.length ?? 0;
  const showUnitToggle = totalSerials > 1;
  const inUnitView = focusedMode === 'serial';

  // Per-serial provenance (SKU · grade · status · PO) keyed by serial, feeding the
  // By-unit band header card. Absent on older payloads ⇒ headers degrade to the
  // serial chip + count.
  const provBySerial = useMemo(() => {
    const m = new Map<string, SerialProvenance>();
    for (const p of entity?.serialProvenance ?? []) {
      const s = p.serial?.trim();
      if (s) m.set(s, p);
    }
    return m;
  }, [entity]);

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto bg-surface-canvas text-text-default">
      <main className="flex-1 w-full max-w-[1100px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-16 space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/10 text-blue-600">
              <History className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-text-default leading-none">
                {focused ? `${dimLabel} record` : 'Operations record'}
              </h1>
              <div className="mt-1 flex items-center gap-1.5">
                {focused ? (
                  <>
                    <RecordChip dim={url.dim} value={url.entityValue} />
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<X />}
                      onClick={() => url.setEntity('')}
                      ariaLabel="Clear record"
                      className="text-eyebrow font-bold uppercase tracking-widest text-text-faint hover:text-text-muted"
                    >
                      Clear
                    </Button>
                  </>
                ) : (
                  <p className="text-eyebrow font-bold uppercase tracking-widest text-text-soft">
                    Paste a record number to begin
                  </p>
                )}
              </div>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-border-soft bg-surface-card p-5 sm:p-6">
          {!focused ? (
            <div className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-4 py-12 text-center">
              <History className="mx-auto h-7 w-7 text-text-faint" />
              <p className="mt-3 text-caption font-semibold text-text-muted">
                Paste a record number to see its complete timeline
              </p>
              <p className="mt-1 text-micro leading-5 text-text-faint">
                Search an order, serial, or tracking number in the sidebar — its full journey across
                every station appears here.
              </p>
            </div>
          ) : journey.isError ? (
            <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-10 text-center">
              <p className="text-caption font-semibold text-rose-600">
                No record found for this {url.dim} number.
              </p>
              <Button
                variant="secondary"
                size="sm"
                icon={<Loader2 />}
                onClick={() => journey.refetch()}
                className="mt-2 border border-rose-200 text-rose-600 hover:bg-rose-50"
              >
                Retry
              </Button>
            </div>
          ) : (
            <TimelineSection
              title="Record timeline"
              loading={journey.isLoading}
              items={items}
              groupMode={focusedMode}
              groupKeyOf={inUnitView ? journeyKeyOf('serial', groupOf) : undefined}
              collapsibleGroups={inUnitView}
              renderGroupHeader={
                inUnitView
                  ? (g) => (
                      <SerialProvenanceHeader
                        group={g}
                        provenance={provBySerial.get((g.ref?.value ?? g.label ?? '').trim())}
                        siblingCount={Math.max(0, totalSerials - 1)}
                      />
                    )
                  : undefined
              }
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
                      <IconButton
                        onClick={() => downloadJourneyCsv(url.entityValue, items)}
                        ariaLabel="Export CSV"
                        icon={<Download className="h-3.5 w-3.5" />}
                        className="-my-0.5 rounded p-1 text-text-faint hover:bg-surface-sunken hover:text-text-muted"
                      />
                    </HoverTooltip>
                    <HoverTooltip label="Print / Save as PDF">
                      <IconButton
                        onClick={() => printJourney(url.entityValue, items)}
                        ariaLabel="Print or save as PDF"
                        icon={<FileText className="h-3.5 w-3.5" />}
                        className="-my-0.5 rounded p-1 text-text-faint hover:bg-surface-sunken hover:text-text-muted"
                      />
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
