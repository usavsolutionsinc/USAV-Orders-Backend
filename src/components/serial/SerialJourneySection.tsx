'use client';

/**
 * Serial Number Journey — the embeddable drop-in.
 *
 * The whole per-serial lifecycle already exists server-side: every station
 * (receiving → putaway → tested → graded → allocated → picked → packed →
 * shipped → returned/repair/RMA) writes an idempotent `inventory_events` row
 * carrying `serial_unit_id`, and `GET /api/operations/journey?dim=serial` merges
 * that with the SAL / audit / carrier / warranty spines. This component is just
 * a thin, context-embeddable surface over that data — mirroring
 * `OrderTimelineSection` but serial-scoped — so a unit/SKU detail pane, a mobile
 * scan result, or a modal can show a serial's full journey with one line:
 *
 *   <SerialJourneySection serialNumber={unit.serial_number} />
 *
 * It reuses the shared query factory, the `mergeJourney` adapters, and the
 * `TimelineSection`/`EventTimeline` primitive — no new API, adapter, or schema.
 * For the full-page experience (date/station/type filters), it deep-links to
 * Operations ▸ History via {@link buildSerialJourneyHref}.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Download, ExternalLink, FileText } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { TimelineSection } from '@/components/ui/TimelineSection';
import { mergeJourney, countRoundTrips } from '@/lib/timeline/journey';
import { operationsJourneyFocusedQuery } from '@/lib/queries/operations-journey-queries';
import {
  buildSerialJourneyHref,
  downloadJourneyCsv,
  printJourney,
  serialJourneyFilters,
} from '@/lib/serial/serial-journey';

export interface SerialJourneySectionProps {
  /** The serial number to render the journey for. Empty ⇒ a quiet "no serial" state. */
  serialNumber: string;
  title?: string;
  density?: 'comfortable' | 'compact';
  /** Show the deep link to the full-page Operations ▸ History journey (default true). */
  linkToFull?: boolean;
  /** Show CSV / print-to-PDF export actions (default true). */
  exportable?: boolean;
  /** Outer wrapper classes — forwarded to {@link TimelineSection}. */
  className?: string;
}

/** A small icon action for the section header (tooltip-labeled, hit-box bled). */
function HeaderAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <HoverTooltip label={label}>
      <IconButton
        icon={children}
        onClick={onClick}
        ariaLabel={label}
        className="-my-0.5 inline-flex items-center rounded p-1 hover:bg-gray-100"
      />
    </HoverTooltip>
  );
}

export function SerialJourneySection({
  serialNumber,
  title = 'Serial journey',
  density = 'comfortable',
  linkToFull = true,
  exportable = true,
  className,
}: SerialJourneySectionProps) {
  const serial = serialNumber.trim();
  const filters = useMemo(() => serialJourneyFilters(serial), [serial]);

  const query = useQuery({
    ...operationsJourneyFocusedQuery(filters),
    enabled: serial.length > 0,
  });

  const events = query.data?.events ?? [];
  const { items } = useMemo(() => mergeJourney(events), [events]);

  const count = items.length;
  const loading = serial.length > 0 && query.isLoading;
  const hasItems = !loading && count > 0;

  // Round-trip counts (§1 success metric) — see countRoundTrips' own doc for
  // why this is two counts, not one combined "trips" figure.
  const { shippedCount, returnedCount } = useMemo(() => countRoundTrips(items), [items]);
  const hasRoundTrips = shippedCount > 0 || returnedCount > 0;

  // A sub-resource must degrade, not crash the host pane (Workbench rule): a
  // failed journey fetch renders a quiet inline error, never throws upward.
  if (serial.length > 0 && query.isError) {
    return (
      <section className={className ?? 'mx-8 mt-2 border-t border-gray-100 pt-4 pb-8'}>
        <header className="mb-3">
          <h3 className="text-eyebrow font-bold uppercase tracking-[0.14em] text-gray-400">{title}</h3>
        </header>
        <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center text-caption font-semibold text-rose-600">
          Could not load this serial&rsquo;s journey.
          <Button
            variant="ghost"
            size="sm"
            onClick={() => query.refetch()}
            className="ml-2 h-auto px-0 text-rose-600 underline decoration-dotted hover:bg-transparent hover:text-rose-700"
          >
            Retry
          </Button>
        </div>
      </section>
    );
  }

  const headerRight = (
    <div className="flex items-center gap-1.5">
      {hasItems && exportable ? (
        <>
          <HeaderAction label="Export CSV" onClick={() => downloadJourneyCsv(serial, items)}>
            <Download className="h-3.5 w-3.5" />
          </HeaderAction>
          <HeaderAction label="Print / Save as PDF" onClick={() => printJourney(serial, items)}>
            <FileText className="h-3.5 w-3.5" />
          </HeaderAction>
        </>
      ) : null}
      {linkToFull && serial ? (
        <HoverTooltip label="Open full journey with filters">
          <Link
            href={buildSerialJourneyHref(serial)}
            aria-label="Open full journey"
            className="-my-0.5 inline-flex items-center rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </HoverTooltip>
      ) : null}
      {hasRoundTrips ? (
        <HoverTooltip label="Ship/return round trips for this serial">
          <span className="flex items-center gap-1">
            {shippedCount > 0 ? (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-emerald-700 ring-1 ring-inset ring-emerald-200">
                {shippedCount} shipped
              </span>
            ) : null}
            {returnedCount > 0 ? (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-700 ring-1 ring-inset ring-amber-200">
                {returnedCount} returned
              </span>
            ) : null}
          </span>
        </HoverTooltip>
      ) : null}
      {hasItems ? (
        <span className="ml-1 tabular-nums">
          {count.toLocaleString()} event{count === 1 ? '' : 's'}
        </span>
      ) : null}
    </div>
  );

  return (
    <TimelineSection
      title={title}
      loading={loading}
      items={items}
      density={density}
      richTime
      emptyMessage={serial ? 'No events recorded for this serial yet.' : 'No serial selected.'}
      headerRight={headerRight}
      className={className}
    />
  );
}
