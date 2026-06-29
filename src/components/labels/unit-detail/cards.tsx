'use client';

import React, { useMemo } from 'react';
import { timeAgo } from '@/utils/_date';
import { unitStatusBadgeClass } from '@/lib/unit-status';
import { conditionBadgeTone } from '@/components/station/receiving-constants';
import { SerialChip, SkuSerialChip } from '@/components/ui/CopyChip';
import { PhotoGallery } from '@/components/shipped/PhotoGallery';
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
import type {
  UnitDetail,
  TimelineEvent,
  Allocation,
  ConditionRow,
  TsnLink,
  LocationDetail,
  UnitPhoto,
} from './types';

// ─── Shared formatting helpers ───────────────────────────────────────────────

export function prettyLabel(t: string): string {
  return t.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusPill({ status }: { status: string | null }) {
  const v = (status || 'UNKNOWN').toUpperCase();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-micro font-bold uppercase tracking-wide ${unitStatusBadgeClass(v)}`}
    >
      {v}
    </span>
  );
}

export function ConditionPill({ grade }: { grade: string | null }) {
  if (!grade) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-micro font-bold uppercase tracking-wide ${conditionBadgeTone(grade)}`}
    >
      {prettyLabel(grade)}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-eyebrow font-black uppercase tracking-[0.14em] text-gray-400">{label}</dt>
      <dd className="mt-0.5 truncate text-caption font-semibold text-gray-900">{children}</dd>
    </div>
  );
}

// ─── Identity summary ────────────────────────────────────────────────────────

/** One labeled id row: tiny gray eyebrow + a copy chip (last-4, copies full). */
function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-eyebrow font-black uppercase tracking-[0.14em] text-gray-400">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * Top-of-body summary — product title is the PRIMARY (large, dark) line, with
 * the SKU on top and the serial below it as copy chips (last-4 display, copy
 * the full value on click). The serial is the one LINKED to the QR label (from
 * tech_serial_numbers lineage), not the raw label text.
 */
export function IdentityCard({ unit }: { unit: UnitDetail }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200/60">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {/* PRIMARY — product title */}
          <p className="text-lg font-bold leading-snug text-gray-900 break-words">
            {unit.product_title || unit.sku || unit.serial_number}
          </p>
          {/* SKU on top, serial below — both copy chips. */}
          <div className="mt-2 space-y-1.5">
            {unit.sku ? (
              <ChipRow label="SKU">
                <SkuSerialChip value={unit.sku} display={unit.sku} width="w-fit" />
              </ChipRow>
            ) : null}
            <ChipRow label="Serial">
              <SerialChip value={unit.serial_number} width="w-fit" />
            </ChipRow>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusPill status={unit.current_status} />
          <ConditionPill grade={unit.condition_grade} />
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-gray-100 pt-4 sm:grid-cols-4">
        <Field label="Received">
          {unit.received_at ? timeAgo(unit.received_at) : '—'}
        </Field>
        <Field label="Received by">{unit.received_by_name ?? '—'}</Field>
        <Field label="Origin">{unit.origin_source ?? '—'}</Field>
        <Field label="Last updated">{timeAgo(unit.updated_at)}</Field>
      </dl>
    </section>
  );
}

// ─── Location + order pair ───────────────────────────────────────────────────

/**
 * Working location display. Resolves the unit's denormalized
 * `current_location` to its full bin row (room / zone / type) when known, and
 * shows an explicit "not stocked" state otherwise — instead of silently
 * rendering blank.
 */
export function LocationCard({
  location,
  detail,
}: {
  location: string | null;
  detail: LocationDetail | null | undefined;
}) {
  const stocked = !!(location && location.trim());
  const sub = detail
    ? [detail.room, detail.zone_letter ? `Zone ${detail.zone_letter}` : null, detail.bin_type]
        .filter(Boolean)
        .join(' · ') || 'Current bin'
    : stocked
      ? 'Current bin / zone'
      : 'Scan into a bin from /m/u to stock it';

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200/60">
      <p className="text-eyebrow font-black uppercase tracking-[0.18em] text-gray-400">Location</p>
      <div className="mt-2 flex items-center gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            stocked ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'
          }`}
        >
          <MapPin className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-base font-bold text-gray-900">
            {stocked ? location : 'Not stocked'}
          </p>
          <p className="truncate text-micro font-medium text-gray-500">{sub}</p>
        </div>
      </div>
    </section>
  );
}

export function OrderCard({ allocation }: { allocation: Allocation | null }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200/60">
      <p className="text-eyebrow font-black uppercase tracking-[0.18em] text-gray-400">Order</p>
      <div className="mt-2 flex items-center gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            allocation ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'
          }`}
        >
          <ShoppingCart className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-base font-bold text-gray-900">
            {allocation?.order_id ?? 'Unallocated'}
          </p>
          <p className="truncate text-micro font-medium text-gray-500">
            {allocation
              ? `${allocation.state} · ${timeAgo(allocation.allocated_at)}`
              : 'No open allocation'}
          </p>
        </div>
      </div>
    </section>
  );
}

// ─── Timeline ────────────────────────────────────────────────────────────────

/** Pull the photo_ids array an event carries (photo-capture NOTE events). */
function eventPhotoIds(payload: Record<string, unknown> | null): number[] {
  const raw = payload?.photo_ids;
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => Number(x)).filter((n) => Number.isFinite(n));
}

export function TimelineCard({
  events,
  photos = [],
  onPhotoChanged,
}: {
  events: TimelineEvent[];
  /** The unit's photos, cross-referenced by event.payload.photo_ids so capture
   *  events render their shots inline (and a deleted photo drops from the row). */
  photos?: UnitPhoto[];
  onPhotoChanged?: () => void;
}) {
  const sorted = useMemo(
    () => [...events].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1)),
    [events],
  );
  const photosById = useMemo(() => {
    const m = new Map<number, UnitPhoto>();
    for (const p of photos) m.set(p.id, p);
    return m;
  }, [photos]);

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
            <TimelineRow
              key={e.id}
              event={e}
              photosById={photosById}
              onPhotoChanged={onPhotoChanged}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function TimelineRow({
  event,
  photosById,
  onPhotoChanged,
}: {
  event: TimelineEvent;
  photosById?: Map<number, UnitPhoto>;
  onPhotoChanged?: () => void;
}) {
  const { icon: Icon, tone } = ICON_FOR_EVENT[event.event_type] ?? ICON_FOR_EVENT.DEFAULT;
  const statusChanged =
    event.prev_status && event.next_status && event.prev_status !== event.next_status;

  // Photos captured at this event — resolved against the live photos list so a
  // delete drops the thumbnail too (rather than a stale id baked into payload).
  const eventPhotos = photosById
    ? eventPhotoIds(event.payload).map((id) => photosById.get(id)).filter((p): p is UnitPhoto => !!p)
    : [];

  return (
    <li className="flex gap-3 px-5 py-3">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-label font-bold text-gray-900">{prettyLabel(event.event_type)}</span>
          <span className="text-micro text-gray-400">{timeAgo(event.occurred_at)}</span>
          {event.station ? (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-micro font-bold uppercase tracking-wider text-gray-500">
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
        {event.notes ? <p className="mt-1 text-caption text-gray-600">{event.notes}</p> : null}
        {eventPhotos.length > 0 ? (
          <div className="mt-2">
            <PhotoGallery
              photos={eventPhotos.map((p) => ({ id: p.id, url: p.url }))}
              launcherLayout="thumbnails"
              onPhotoDeleted={onPhotoChanged}
            />
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function AllocationsCard({ rows }: { rows: Allocation[] }) {
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
                className={`rounded px-1.5 py-0.5 text-micro font-bold uppercase tracking-wider ${
                  a.state === 'RELEASED'
                    ? 'bg-gray-100 text-gray-500'
                    : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                {a.state}
              </span>
            </div>
            <div className="mt-0.5 text-micro text-gray-500">
              Allocated {timeAgo(a.allocated_at)}{a.allocated_by_name ? ` by ${a.allocated_by_name}` : ''}
              {a.released_at ? ` · released ${timeAgo(a.released_at)}` : ''}
              {a.released_reason ? ` (${a.released_reason})` : ''}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ConditionsCard({ rows }: { rows: ConditionRow[] }) {
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
              {timeAgo(c.assessed_at)}{c.assessed_by_name ? ` · ${c.assessed_by_name}` : ''}
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

export function TsnLinksCard({ rows }: { rows: TsnLink[] }) {
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
              <span className="text-micro text-gray-400">{timeAgo(t.created_at)}</span>
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

// ─── States ──────────────────────────────────────────────────────────────────

export function DetailEmptyState({ fromRecent = false }: { fromRecent?: boolean }) {
  const Icon = fromRecent ? Printer : History;
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <Icon className="mb-3 h-10 w-10 text-gray-300" />
      <p className="text-eyebrow font-black uppercase tracking-[0.18em] text-gray-400">
        {fromRecent ? 'Recently printed' : 'Unit history'}
      </p>
      <p className="mt-3 max-w-[420px] text-sm font-medium text-gray-500">
        {fromRecent
          ? "Select a recently printed label from the sidebar to view that unit's full detail — SKU, condition, status, location, and lifecycle timeline."
          : "Scan a DataMatrix from the sidebar to load a unit's full audit trail — every receive, move, allocation, and ship event in one timeline."}
      </p>
    </div>
  );
}

export function DetailLoadingState() {
  return (
    <div className="flex h-full items-center justify-center px-6 py-12">
      <p className="text-caption font-semibold text-gray-400">Loading unit…</p>
    </div>
  );
}

export function DetailErrorState({ message }: { message: string }) {
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

// ─── Event icon table ────────────────────────────────────────────────────────

const ICON_FOR_EVENT: Record<string, { icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  RECEIVED:   { icon: PackageCheck,   tone: 'bg-amber-100 text-amber-700' },
  LABELED:    { icon: Printer,        tone: 'bg-amber-50 text-amber-700' },
  PUTAWAY:    { icon: MapPin,         tone: 'bg-emerald-100 text-emerald-700' },
  MOVED:      { icon: ChevronRight,   tone: 'bg-blue-100 text-blue-700' },
  TEST_START: { icon: Wrench,         tone: 'bg-slate-100 text-slate-600' },
  TEST_PASS:  { icon: Check,          tone: 'bg-emerald-100 text-emerald-700' },
  TEST_FAIL:  { icon: AlertTriangle,  tone: 'bg-rose-100 text-rose-700' },
  PICKED:     { icon: Package,        tone: 'bg-indigo-100 text-indigo-700' },
  PACKED:     { icon: Package,        tone: 'bg-indigo-100 text-indigo-700' },
  SHIPPED:    { icon: Truck,          tone: 'bg-violet-100 text-violet-700' },
  RETURNED:   { icon: ChevronRight,   tone: 'bg-rose-100 text-rose-700' },
  SCRAPPED:   { icon: AlertTriangle,  tone: 'bg-red-100 text-red-700' },
  LISTED:     { icon: ClipboardList,  tone: 'bg-blue-100 text-blue-700' },
  NOTE:       { icon: ClipboardList,  tone: 'bg-slate-100 text-slate-600' },
  ADJUSTED:   { icon: Wrench,         tone: 'bg-slate-100 text-slate-600' },
  DEFAULT:    { icon: Clock,          tone: 'bg-slate-100 text-slate-600' },
};
