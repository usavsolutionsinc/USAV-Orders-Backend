'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatPSTTimestamp } from '@/utils/date';
import { Camera, Package, User as UserIcon } from '@/components/Icons';
import { AuditLogDailyReport } from './AuditLogDailyReport';

interface PackingEvent {
  id: string;
  occurred_at: string;
  source: 'packer_log' | 'station_activity_log' | 'audit_log' | 'photo';
  kind: string;
  actor_staff_id: number | null;
  actor_name: string | null;
  station: string | null;
  notes: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  detail: Record<string, unknown>;
}

interface PackerLog {
  id: number;
  pack_date_time: string | null;
  packed_by_id: number | null;
  packed_by_name: string | null;
  tracking_type: string | null;
  photo_urls: string[];
}

interface PackingDetail {
  tracking: string;
  packer_logs: PackerLog[];
  events: PackingEvent[];
  sku_summary: string | null;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return formatPSTTimestamp(new Date(iso));
  } catch {
    return iso;
  }
}

const KIND_TONE: Record<string, string> = {
  PACK_COMPLETED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  PACK_SCAN: 'bg-sky-50 text-sky-700 ring-sky-200',
  TRACKING_SCANNED: 'bg-sky-50 text-sky-700 ring-sky-200',
  PHOTO_ADDED: 'bg-violet-50 text-violet-700 ring-violet-200',
  FNSKU_SCANNED: 'bg-amber-50 text-amber-700 ring-amber-200',
};

function kindLabel(kind: string): string {
  return kind.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AuditLogPackingClient() {
  const searchParams = useSearchParams();
  const tracking = searchParams.get('tracking');
  const sharedFilters = useSharedFilterParams();

  const [detail, setDetail] = useState<PackingDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tracking) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = new URL('/api/audit-log/packing', window.location.origin);
    url.searchParams.set('tracking', tracking);
    for (const [k, v] of sharedFilters) url.searchParams.set(k, v);
    fetch(url.toString(), { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.success) setDetail(d as PackingDetail);
        else setError(d?.error ?? 'Failed to load packing detail');
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tracking, sharedFilters]);

  if (!tracking) {
    return <AuditLogDailyReport section="packing" />;
  }

  if (loading) {
    return <CenterMessage label="Loading packing timeline…" />;
  }
  if (error) {
    return <CenterMessage label={error} tone="error" />;
  }
  if (!detail) {
    return <CenterMessage label="Pick a tracking from the sidebar." />;
  }

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <p className="text-micro font-bold uppercase tracking-widest text-emerald-700">
          Packing audit
        </p>
        <h2 className="mt-0.5 break-all font-mono text-base font-bold text-gray-900">
          {detail.tracking}
        </h2>
        {detail.sku_summary && (
          <p className="mt-1 text-label text-gray-500">SKU: {detail.sku_summary}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {detail.packer_logs.map((pl) => (
            <span
              key={pl.id}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-micro font-semibold text-emerald-700 ring-1 ring-emerald-200"
            >
              <Package className="h-3 w-3" />
              {pl.tracking_type ?? 'PACK'} · {fmtTime(pl.pack_date_time)}
              {pl.packed_by_name ? ` · ${pl.packed_by_name}` : ''}
            </span>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-3">
          {detail.events.length === 0 ? (
            <CenterMessage label="No events match the current filters." />
          ) : (
            detail.events.map((ev) => <EventRow key={ev.id} event={ev} />)
          )}
        </div>
      </div>
    </section>
  );
}

function EventRow({ event }: { event: PackingEvent }) {
  const tone = KIND_TONE[event.kind] ?? 'bg-slate-100 text-slate-700 ring-slate-200';
  const photoUrl = event.source === 'photo' ? (event.detail.url as string | null) : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-micro font-bold uppercase tracking-wider ring-1 ${tone}`}
            >
              {kindLabel(event.kind)}
            </span>
            {event.station && (
              <span className="text-micro text-gray-500">{event.station}</span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1 text-caption text-gray-500">
            <UserIcon className="h-3 w-3" />
            {event.actor_name ?? (event.actor_staff_id ? `#${event.actor_staff_id}` : 'System')}
          </div>
        </div>
        <div className="shrink-0 text-micro text-gray-400">{fmtTime(event.occurred_at)}</div>
      </div>

      {event.notes && (
        <p className="mt-2 whitespace-pre-wrap break-words text-label text-gray-700">
          {event.notes}
        </p>
      )}

      {photoUrl && (
        <div className="mt-2 flex items-center gap-2">
          <Camera className="h-3.5 w-3.5 text-violet-600" />
          <a
            href={photoUrl}
            target="_blank"
            rel="noreferrer"
            className="break-all text-caption font-semibold text-violet-700 hover:underline"
          >
            View photo
          </a>
        </div>
      )}

      {(event.before || event.after) && (
        <pre className="mt-2 overflow-x-auto rounded-md bg-gray-50 p-2 text-micro text-gray-700">
          {JSON.stringify({ before: event.before, after: event.after }, null, 2)}
        </pre>
      )}
    </div>
  );
}

function CenterMessage({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'error';
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <p
        className={`text-center text-label ${
          tone === 'error' ? 'text-rose-600' : 'text-gray-400'
        }`}
      >
        {label}
      </p>
    </div>
  );
}

function useSharedFilterParams(): Array<[string, string]> {
  const sp = useSearchParams();
  const result: Array<[string, string]> = [];
  for (const k of ['day', 'start', 'end', 'staffId', 'sku']) {
    const v = sp.get(k);
    if (v) result.push([k, v]);
  }
  return result;
}
