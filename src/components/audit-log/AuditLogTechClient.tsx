'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatPSTTimestamp } from '@/utils/date';
import { FileText, User as UserIcon } from '@/components/Icons';
import { AuditLogDailyReport } from './AuditLogDailyReport';

interface TechEvent {
  id: string;
  occurred_at: string;
  source: 'tech_serial_number' | 'station_activity_log' | 'audit_log';
  kind: string;
  actor_staff_id: number | null;
  actor_name: string | null;
  station: string | null;
  serial_number: string | null;
  sku: string | null;
  notes: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  detail: Record<string, unknown>;
}

interface TechSerial {
  id: number;
  serial_number: string;
  serial_type: string | null;
  test_date_time: string | null;
  tester_id: number | null;
  tester_name: string | null;
  sku: string | null;
}

interface TechDetail {
  tracking: string;
  serials: TechSerial[];
  events: TechEvent[];
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
  SERIAL_TESTED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  SERIAL_ADDED: 'bg-sky-50 text-sky-700 ring-sky-200',
  FNSKU_SCANNED: 'bg-amber-50 text-amber-700 ring-amber-200',
  FBA_READY: 'bg-violet-50 text-violet-700 ring-violet-200',
};

function kindLabel(kind: string): string {
  return kind.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AuditLogTechClient() {
  const searchParams = useSearchParams();
  const session = searchParams.get('session');
  const sharedQS = useSharedQS();

  const [detail, setDetail] = useState<TechDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = new URL('/api/audit-log/tech', window.location.origin);
    url.searchParams.set('session', session);
    if (sharedQS) for (const [k, v] of new URLSearchParams(sharedQS)) url.searchParams.set(k, v);
    fetch(url.toString(), { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.success) setDetail(d as TechDetail);
        else setError(d?.error ?? 'Failed to load tech detail');
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [session, sharedQS]);

  if (!session) {
    return <AuditLogDailyReport section="tech" />;
  }
  if (loading) {
    return <CenterMessage label="Loading tech timeline…" />;
  }
  if (error) {
    return <CenterMessage label={error} tone="error" />;
  }
  if (!detail) {
    return <CenterMessage label="Pick a session from the sidebar." />;
  }

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <p className="text-micro font-bold uppercase tracking-widest text-emerald-700">
          Tech audit
        </p>
        <h2 className="mt-0.5 break-all font-mono text-base font-bold text-gray-900">
          {detail.tracking}
        </h2>
        {detail.sku_summary && (
          <p className="mt-1 text-label text-gray-500">SKU: {detail.sku_summary}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {detail.serials.slice(0, 8).map((sn) => (
            <span
              key={sn.id}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-micro font-semibold text-emerald-700 ring-1 ring-emerald-200"
            >
              <FileText className="h-3 w-3" />
              {sn.serial_number}
            </span>
          ))}
          {detail.serials.length > 8 && (
            <span className="text-micro text-gray-500">
              +{detail.serials.length - 8} more
            </span>
          )}
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

function EventRow({ event }: { event: TechEvent }) {
  const tone = KIND_TONE[event.kind] ?? 'bg-slate-100 text-slate-700 ring-slate-200';
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
          {(event.serial_number || event.sku) && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-micro text-gray-500">
              {event.serial_number && (
                <span className="font-mono font-semibold text-gray-700">
                  {event.serial_number}
                </span>
              )}
              {event.sku && <span>SKU: {event.sku}</span>}
            </div>
          )}
        </div>
        <div className="shrink-0 text-micro text-gray-400">{fmtTime(event.occurred_at)}</div>
      </div>

      {event.notes && (
        <p className="mt-2 whitespace-pre-wrap break-words text-label text-gray-700">
          {event.notes}
        </p>
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

function useSharedQS(): string {
  const sp = useSearchParams();
  const next = new URLSearchParams();
  for (const k of ['day', 'start', 'end', 'staffId', 'sku']) {
    const v = sp.get(k);
    if (v) next.set(k, v);
  }
  return next.toString();
}
