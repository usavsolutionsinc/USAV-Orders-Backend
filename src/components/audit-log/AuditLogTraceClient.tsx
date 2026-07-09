'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search, MapPin, ShoppingCart, PackageCheck } from '@/components/Icons';
import { AuditCenterMessage } from './AuditEventCard';
import { EventTimeline, type TimelineGroupMode } from '@/components/ui/EventTimeline';
import { inventoryEventsToTimeline, type InventoryTimelineRow } from '@/lib/timeline';
import { SerialChip, SkuSerialChip, OrderIdChip, TrackingChip, getLast4 } from '@/components/ui/CopyChip';
import { timeAgo } from '@/utils/_date';

interface TraceUnit {
  id: number | null;
  serial_number: string;
  normalized_serial: string;
  unit_uid: string | null;
  sku: string | null;
  product_title: string | null;
  current_status: string | null;
  current_location: string | null;
  condition_grade: string | null;
  origin_source: string | null;
  received_at: string | null;
  received_by_name: string | null;
}

interface TraceOrder {
  order_id: string | null;
  product_title: string | null;
  tracking_number: string | null;
  allocation_state: string;
  allocated_at: string | null;
  via: 'allocation' | 'tsn';
}

interface TraceResult {
  found: boolean;
  unit: TraceUnit | null;
  order: TraceOrder | null;
  events: InventoryTimelineRow[];
}

/** Serial↔order grouping toggle (same control language as the order timeline). */
function IdentifierToggle({
  mode,
  onChange,
}: {
  mode: TimelineGroupMode;
  onChange: (m: TimelineGroupMode) => void;
}) {
  const opts: { value: TimelineGroupMode; label: string }[] = [
    { value: 'time', label: 'Time' },
    { value: 'serial', label: 'Serial' },
  ];
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-md bg-surface-sunken p-0.5"
      role="tablist"
      aria-label="Timeline grouping"
    >
      {opts.map((o) => {
        const active = mode === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`ds-raw-button rounded px-2 py-0.5 text-eyebrow font-bold uppercase tracking-[0.1em] transition-colors ${
              active ? 'bg-surface-card text-text-muted shadow-sm' : 'text-text-faint hover:text-text-muted'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function FactCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string | null;
}) {
  return (
    <section className="rounded-2xl bg-surface-card p-4 shadow-sm ring-1 ring-border-soft/60">
      <p className="text-eyebrow font-black uppercase tracking-[0.18em] text-text-faint">{label}</p>
      <div className="mt-2 flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold text-text-default">{value}</div>
          {sub ? <p className="truncate text-micro font-medium text-text-soft">{sub}</p> : null}
        </div>
      </div>
    </section>
  );
}

/**
 * First-Trace client — given a serial (via `?serial=`), traces one physical unit
 * from origin through every station on the shared {@link EventTimeline}: a unit
 * identity header (serial/SKU/status/location), the shipped sales order (when
 * known), then the full receiving → testing → putaway → pick → pack → ship →
 * return trail with who + when at each step. Serial↔time grouping toggle reuses
 * the same primitive as the order/Shipped panels — no second timeline.
 */
export function AuditLogTraceClient() {
  const searchParams = useSearchParams();
  const serial = searchParams.get('serial')?.trim() || '';
  const [groupMode, setGroupMode] = useState<TimelineGroupMode>('time');

  const [data, setData] = useState<TraceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!serial) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = new URL('/api/audit-log/trace', window.location.origin);
    url.searchParams.set('serial', serial);
    fetch(url.toString(), { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.success) setData(d as TraceResult);
        else setError(d?.error ?? 'Failed to load trace');
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [serial]);

  // The trace events are already inventory_events spine rows — feed them straight
  // through the shared adapter. Newest-first to match the timeline's day-banding.
  const items = useMemo(() => {
    const rows = [...(data?.events ?? [])].sort((a, b) => {
      const ta = a.occurred_at ? new Date(a.occurred_at).getTime() : 0;
      const tb = b.occurred_at ? new Date(b.occurred_at).getTime() : 0;
      return tb - ta;
    });
    return inventoryEventsToTimeline(rows);
  }, [data?.events]);

  if (!serial) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
        <Search className="mb-3 h-10 w-10 text-text-faint" />
        <p className="text-eyebrow font-black uppercase tracking-[0.18em] text-text-faint">
          First Trace
        </p>
        <p className="mt-3 max-w-[420px] text-sm font-medium text-text-soft">
          Scan or enter a serial in the sidebar to trace one unit from origin through every
          station — receiving, testing, putaway, pick, pack, ship, and return — with who and
          when at each step.
        </p>
      </div>
    );
  }
  if (loading) return <AuditCenterMessage label="Tracing unit…" />;
  if (error) return <AuditCenterMessage label={error} tone="error" />;
  if (!data || !data.found || !data.unit) {
    return <AuditCenterMessage label={`No unit found for serial "${serial}".`} />;
  }

  const unit = data.unit;
  const order = data.order;

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-canvas">
      <div className="border-b border-border-soft bg-surface-card px-6 py-4">
        <p className="text-micro font-bold uppercase tracking-widest text-emerald-700">First Trace</p>
        <h2 className="mt-0.5 break-words text-base font-bold text-text-default">
          {unit.product_title || unit.sku || unit.serial_number}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <SerialChip value={unit.serial_number} width="w-fit" />
          {unit.sku ? <SkuSerialChip value={unit.sku} display={unit.sku} width="w-fit" /> : null}
          {unit.current_status ? (
            <span className="inline-flex items-center rounded-full bg-surface-sunken px-2 py-0.5 text-micro font-bold uppercase tracking-wide text-text-muted">
              {unit.current_status}
            </span>
          ) : null}
          {unit.condition_grade ? (
            <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-micro font-bold uppercase tracking-wide text-blue-700">
              {unit.condition_grade}
            </span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FactCard
              icon={<PackageCheck className="h-4 w-4" />}
              label="Origin"
              value={unit.origin_source ? unit.origin_source : '—'}
              sub={
                unit.received_at
                  ? `Received ${timeAgo(unit.received_at)}${
                      unit.received_by_name ? ` by ${unit.received_by_name}` : ''
                    }`
                  : 'No receiving record'
              }
            />
            <FactCard
              icon={<MapPin className="h-4 w-4" />}
              label="Location"
              value={unit.current_location || 'Not stocked'}
              sub={unit.current_location ? 'Current bin' : null}
            />
          </div>

          {order ? (
            <section className="rounded-2xl bg-surface-card p-4 shadow-sm ring-1 ring-border-soft/60">
              <p className="text-eyebrow font-black uppercase tracking-[0.18em] text-text-faint">
                Shipped on order
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
                  <ShoppingCart className="h-4 w-4" />
                </span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  {order.order_id ? (
                    <OrderIdChip value={order.order_id} display={order.order_id} dense />
                  ) : (
                    <span className="text-base font-bold text-text-default">Order</span>
                  )}
                  {order.tracking_number ? (
                    <TrackingChip
                      value={order.tracking_number}
                      display={getLast4(order.tracking_number)}
                      dense
                      fitDisplayWidth
                    />
                  ) : null}
                  <span className="text-micro font-medium text-text-soft">
                    {order.allocation_state}
                    {order.allocated_at ? ` · ${timeAgo(order.allocated_at)}` : ''}
                  </span>
                </div>
              </div>
            </section>
          ) : null}

          <section className="rounded-xl border border-border-hairline bg-surface-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-eyebrow font-black uppercase tracking-wider text-text-soft">
                Lifecycle trail
              </h3>
              <div className="flex items-center gap-3 text-micro font-medium text-text-faint">
                {items.some((it) => it.ref) ? (
                  <IdentifierToggle mode={groupMode} onChange={setGroupMode} />
                ) : null}
                <span>
                  {items.length} {items.length === 1 ? 'event' : 'events'}
                </span>
              </div>
            </div>
            <EventTimeline
              items={items}
              groupMode={groupMode}
              emptyMessage="No lifecycle events recorded for this unit yet."
            />
          </section>
        </div>
      </div>
    </section>
  );
}
