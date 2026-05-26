'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { timeAgo } from '@/utils/_date';
import {
  History,
  Package,
  Printer,
  PackageCheck,
  Wrench,
  Truck,
  ChevronRight,
  Check,
  AlertTriangle,
  MapPin,
  ShoppingCart,
  ClipboardList,
  Clock,
} from '@/components/Icons';

// ─── Types — keep loose since the API returns mixed shapes ─────────────────

interface UnitDetail {
  id: number;
  serial_number: string;
  normalized_serial: string;
  sku: string | null;
  current_status: string;
  current_location: string | null;
  condition_grade: string | null;
  origin_source: string | null;
  origin_receiving_line_id: number | null;
  received_at: string | null;
  received_by: number | null;
  received_by_name: string | null;
  product_title: string | null;
  created_at: string;
  updated_at: string;
}

interface TimelineEvent {
  id: number;
  occurred_at: string;
  event_type: string;
  station: string | null;
  prev_status: string | null;
  next_status: string | null;
  bin_id: number | null;
  bin_name?: string | null;
  actor_staff_id: number | null;
  actor_name?: string | null;
  scan_token: string | null;
  notes: string | null;
  payload: Record<string, unknown> | null;
}

interface Allocation {
  id: number;
  order_id: string;
  allocated_at: string;
  state: string;
  released_at: string | null;
  released_reason: string | null;
  allocated_by_name: string | null;
}

interface ConditionRow {
  id: number;
  assessed_at: string;
  assessed_by_name: string | null;
  prev_grade: string | null;
  new_grade: string;
  cosmetic_notes: string | null;
  functional_notes: string | null;
}

interface TsnLink {
  id: number;
  station_source: string | null;
  shipment_id: number | null;
  serial_type: string | null;
  fnsku: string | null;
  tested_by_name: string | null;
  created_at: string;
}

interface UnitResponse {
  success: boolean;
  serial_unit: UnitDetail;
  events: TimelineEvent[];
  events_full?: TimelineEvent[];
  conditions?: ConditionRow[];
  allocations?: Allocation[];
  tsn_links?: TsnLink[];
}

// ─── Workspace ──────────────────────────────────────────────────────────────

/**
 * Unit history workspace — main pane for `?view=labels&labelsView=history`.
 * Reads the lookup key from `?historyId=` (written by UnitHistoryFinder) and
 * fetches `/api/serial-units/{key}?include=full`, which already returns the
 * full timeline + allocations + condition history + tsn cross-refs.
 *
 * Empty / loading / error states all render in the workspace; the sidebar
 * handles input. This stays a pure read view — pairing / move actions are
 * intentionally deferred to the mobile flow (`/m/u/[id]`) in Phase 4.
 */
export function UnitHistoryWorkspace() {
  const searchParams = useSearchParams();
  const historyId = searchParams.get('historyId') || '';

  const { data, isLoading, isError, error } = useQuery<UnitResponse>({
    queryKey: ['serial-unit.detail', historyId],
    enabled: historyId.length > 0,
    queryFn: async () => {
      const res = await fetch(
        `/api/serial-units/${encodeURIComponent(historyId)}?include=full`,
        { cache: 'no-store' },
      );
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      return json as UnitResponse;
    },
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  if (!historyId) return <EmptyState />;
  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState message={error instanceof Error ? error.message : 'Failed to load unit'} />;
  if (!data) return <EmptyState />;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-gray-50">
      <div className="mx-auto w-full max-w-3xl space-y-4 px-6 py-6">
        <HeaderCard unit={data.serial_unit} />
        <PairingsStrip
          location={data.serial_unit.current_location}
          allocation={(data.allocations ?? []).find((a) => a.state !== 'RELEASED') ?? null}
        />
        <TimelineCard events={data.events_full ?? data.events ?? []} />
        {(data.allocations?.length ?? 0) > 0 && <AllocationsCard rows={data.allocations ?? []} />}
        {(data.conditions?.length ?? 0) > 0 && <ConditionsCard rows={data.conditions ?? []} />}
        {(data.tsn_links?.length ?? 0) > 0 && <TsnLinksCard rows={data.tsn_links ?? []} />}
      </div>
    </div>
  );
}

// ─── Cards ──────────────────────────────────────────────────────────────────

function HeaderCard({ unit }: { unit: UnitDetail }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200/60">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {unit.product_title ? (
            <p className="line-clamp-2 text-sm font-semibold leading-snug text-gray-900">
              {unit.product_title}
            </p>
          ) : null}
          <p className="mt-1 font-mono text-lg font-bold tracking-tight text-gray-900 break-all">
            {unit.serial_number}
          </p>
          {unit.sku ? (
            <p className="mt-0.5 font-mono text-micro text-gray-500">SKU · {unit.sku}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusPill status={unit.current_status} />
          {unit.condition_grade ? (
            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-micro font-bold uppercase tracking-wider text-gray-600">
              {unit.condition_grade.replace(/_/g, ' ')}
            </span>
          ) : null}
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-gray-100 pt-4 sm:grid-cols-4">
        <Field label="Received">
          {unit.received_at ? `${timeAgo(unit.received_at)} ago` : '—'}
        </Field>
        <Field label="Received by">{unit.received_by_name ?? '—'}</Field>
        <Field label="Origin">{unit.origin_source ?? '—'}</Field>
        <Field label="Last updated">{timeAgo(unit.updated_at)} ago</Field>
      </dl>
    </section>
  );
}

function PairingsStrip({
  location,
  allocation,
}: {
  location: string | null;
  allocation: Allocation | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <PairingCard
        title="Location"
        icon={MapPin}
        empty="Not stocked"
        value={location || null}
        sub={location ? 'Current bin / zone' : 'Scan into a bin from /m/u'}
      />
      <PairingCard
        title="Order"
        icon={ShoppingCart}
        empty="Unallocated"
        value={allocation?.order_id ?? null}
        sub={
          allocation
            ? `${allocation.state} · ${timeAgo(allocation.allocated_at)} ago`
            : 'No open allocation'
        }
      />
    </div>
  );
}

function PairingCard({
  title,
  icon: Icon,
  value,
  sub,
  empty,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string | null;
  sub: string;
  empty: string;
}) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200/60">
      <p className="text-eyebrow font-black uppercase tracking-[0.18em] text-gray-400">
        {title}
      </p>
      <div className="mt-2 flex items-center gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'
          }`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-base font-bold text-gray-900">
            {value || empty}
          </p>
          <p className="truncate text-micro font-medium text-gray-500">{sub}</p>
        </div>
      </div>
    </section>
  );
}

function TimelineCard({ events }: { events: TimelineEvent[] }) {
  // Newest first — mirror the desktop unit page's ordering.
  const sorted = useMemo(
    () => [...events].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1)),
    [events],
  );

  return (
    <section className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200/60">
      <header className="flex items-center justify-between px-5 py-4">
        <h3 className="text-eyebrow font-black uppercase tracking-[0.14em] text-gray-500">
          Timeline
        </h3>
        <span className="text-micro font-semibold text-gray-400">
          {sorted.length} {sorted.length === 1 ? 'event' : 'events'}
        </span>
      </header>
      {sorted.length === 0 ? (
        <div className="border-t border-gray-100 px-5 py-8 text-center text-caption font-medium text-gray-400">
          No events recorded yet.
        </div>
      ) : (
        <ol className="border-t border-gray-100 divide-y divide-gray-100">
          {sorted.map((e) => (
            <TimelineRow key={e.id} event={e} />
          ))}
        </ol>
      )}
    </section>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  const { icon: Icon, tone } = ICON_FOR_EVENT[event.event_type] ?? ICON_FOR_EVENT.DEFAULT;
  const statusChanged =
    event.prev_status && event.next_status && event.prev_status !== event.next_status;

  return (
    <li className="flex gap-3 px-5 py-3">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone}`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-label font-bold text-gray-900">
            {prettyEventLabel(event.event_type)}
          </span>
          <span className="text-micro text-gray-400">{timeAgo(event.occurred_at)} ago</span>
          {event.station ? (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
              {event.station}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-gray-500">
          {event.actor_name ? <span>{event.actor_name}</span> : null}
          {statusChanged ? (
            <span className="flex items-center gap-1 font-mono">
              {event.prev_status}
              <ChevronRight className="h-3 w-3" />
              {event.next_status}
            </span>
          ) : null}
          {event.bin_name ? <span className="font-mono">@ {event.bin_name}</span> : null}
        </div>
        {event.notes ? (
          <p className="mt-1 text-caption text-gray-600">{event.notes}</p>
        ) : null}
      </div>
    </li>
  );
}

function AllocationsCard({ rows }: { rows: Allocation[] }) {
  return (
    <section className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200/60">
      <header className="px-5 py-4">
        <h3 className="text-eyebrow font-black uppercase tracking-[0.14em] text-gray-500">
          Order allocations
        </h3>
      </header>
      <ul className="border-t border-gray-100 divide-y divide-gray-100">
        {rows.map((a) => (
          <li key={a.id} className="px-5 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-label font-bold text-gray-900">{a.order_id}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  a.state === 'RELEASED'
                    ? 'bg-gray-100 text-gray-500'
                    : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                {a.state}
              </span>
            </div>
            <div className="mt-0.5 text-micro text-gray-500">
              Allocated {timeAgo(a.allocated_at)} ago{a.allocated_by_name ? ` by ${a.allocated_by_name}` : ''}
              {a.released_at ? ` · released ${timeAgo(a.released_at)} ago` : ''}
              {a.released_reason ? ` (${a.released_reason})` : ''}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConditionsCard({ rows }: { rows: ConditionRow[] }) {
  return (
    <section className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200/60">
      <header className="px-5 py-4">
        <h3 className="text-eyebrow font-black uppercase tracking-[0.14em] text-gray-500">
          Condition history
        </h3>
      </header>
      <ul className="border-t border-gray-100 divide-y divide-gray-100">
        {rows.map((c) => (
          <li key={c.id} className="px-5 py-3">
            <div className="flex items-center gap-2 font-mono text-label font-bold text-gray-900">
              {c.prev_grade ?? '—'}
              <ChevronRight className="h-3 w-3 text-gray-400" />
              {c.new_grade}
            </div>
            <div className="mt-0.5 text-micro text-gray-500">
              {timeAgo(c.assessed_at)} ago{c.assessed_by_name ? ` · ${c.assessed_by_name}` : ''}
            </div>
            {(c.cosmetic_notes || c.functional_notes) && (
              <p className="mt-1 text-caption text-gray-600">
                {[c.cosmetic_notes, c.functional_notes].filter(Boolean).join(' · ')}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function TsnLinksCard({ rows }: { rows: TsnLink[] }) {
  return (
    <section className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200/60">
      <header className="px-5 py-4">
        <h3 className="text-eyebrow font-black uppercase tracking-[0.14em] text-gray-500">
          Tech / station scans
        </h3>
      </header>
      <ul className="border-t border-gray-100 divide-y divide-gray-100">
        {rows.map((t) => (
          <li key={t.id} className="px-5 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-label font-bold text-gray-900">
                {t.station_source || '—'}
                {t.serial_type ? ` · ${t.serial_type}` : ''}
              </span>
              <span className="text-micro text-gray-400">{timeAgo(t.created_at)} ago</span>
            </div>
            <div className="mt-0.5 text-micro text-gray-500">
              {t.tested_by_name ?? 'Unknown actor'}
              {t.shipment_id ? ` · shipment ${t.shipment_id}` : ''}
              {t.fnsku ? ` · FNSKU ${t.fnsku}` : ''}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Small helpers ──────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-eyebrow font-black uppercase tracking-[0.14em] text-gray-400">{label}</dt>
      <dd className="mt-0.5 truncate text-caption font-semibold text-gray-900">{children}</dd>
    </div>
  );
}

function StatusPill({ status }: { status: string | null }) {
  const v = (status || 'UNKNOWN').toUpperCase();
  const tone = STATUS_TONE[v] || 'bg-slate-100 text-slate-600';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-micro font-bold uppercase tracking-wide ${tone}`}
    >
      {v}
    </span>
  );
}

function prettyEventLabel(t: string): string {
  return t.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── States ─────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <History className="mb-3 h-10 w-10 text-gray-300" />
      <p className="text-eyebrow font-black uppercase tracking-[0.18em] text-gray-400">
        Unit history
      </p>
      <p className="mt-3 max-w-[420px] text-sm font-medium text-gray-500">
        Scan a DataMatrix from the sidebar to load a unit's full audit trail —
        every receive, move, allocation, and ship event in one timeline.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center px-6 py-12">
      <p className="text-caption font-semibold text-gray-400">Loading unit…</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <AlertTriangle className="mb-3 h-10 w-10 text-amber-400" />
      <p className="text-eyebrow font-black uppercase tracking-[0.18em] text-amber-600">
        Couldn't load unit
      </p>
      <p className="mt-3 max-w-[420px] text-sm font-medium text-gray-500">{message}</p>
    </div>
  );
}

// ─── Lookup tables ──────────────────────────────────────────────────────────

const STATUS_TONE: Record<string, string> = {
  UNKNOWN: 'bg-slate-100 text-slate-600',
  LABELED: 'bg-amber-100 text-amber-700',
  RECEIVED: 'bg-amber-100 text-amber-800',
  TESTED: 'bg-blue-100 text-blue-700',
  STOCKED: 'bg-emerald-100 text-emerald-700',
  PICKED: 'bg-indigo-100 text-indigo-700',
  SHIPPED: 'bg-violet-100 text-violet-700',
  RETURNED: 'bg-rose-100 text-rose-700',
  RMA: 'bg-rose-100 text-rose-700',
  SCRAPPED: 'bg-red-100 text-red-700',
};

const ICON_FOR_EVENT: Record<string, { icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  RECEIVED:   { icon: PackageCheck, tone: 'bg-amber-100 text-amber-700' },
  LABELED:    { icon: Printer,      tone: 'bg-amber-50 text-amber-700' },
  PUTAWAY:    { icon: MapPin,       tone: 'bg-emerald-100 text-emerald-700' },
  MOVED:      { icon: ChevronRight,   tone: 'bg-blue-100 text-blue-700' },
  TEST_START: { icon: Wrench,       tone: 'bg-slate-100 text-slate-600' },
  TEST_PASS:  { icon: Check, tone: 'bg-emerald-100 text-emerald-700' },
  TEST_FAIL:  { icon: AlertTriangle, tone: 'bg-rose-100 text-rose-700' },
  PICKED:     { icon: Package,      tone: 'bg-indigo-100 text-indigo-700' },
  PACKED:     { icon: Package,      tone: 'bg-indigo-100 text-indigo-700' },
  SHIPPED:    { icon: Truck,        tone: 'bg-violet-100 text-violet-700' },
  RETURNED:   { icon: ChevronRight,   tone: 'bg-rose-100 text-rose-700' },
  SCRAPPED:   { icon: AlertTriangle, tone: 'bg-red-100 text-red-700' },
  LISTED:     { icon: ClipboardList, tone: 'bg-blue-100 text-blue-700' },
  NOTE:       { icon: ClipboardList, tone: 'bg-slate-100 text-slate-600' },
  ADJUSTED:   { icon: Wrench,       tone: 'bg-slate-100 text-slate-600' },
  DEFAULT:    { icon: Clock,        tone: 'bg-slate-100 text-slate-600' },
};
