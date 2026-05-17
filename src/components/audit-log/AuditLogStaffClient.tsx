'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatPSTTimestamp } from '@/utils/date';
import { ClipboardList, Package, FileText, User as UserIcon } from '@/components/Icons';
import { AuditLogDailyReport } from './AuditLogDailyReport';

interface StaffEvent {
  id: string;
  occurred_at: string;
  station: 'receiving' | 'packing' | 'tech' | 'other';
  kind: string;
  tracking: string | null;
  sku: string | null;
  serial_number: string | null;
  notes: string | null;
}

interface StaffDetail {
  staff: { id: number; name: string | null; role: string | null } | null;
  events: StaffEvent[];
  counts: Record<'receiving' | 'packing' | 'tech' | 'other', number>;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return formatPSTTimestamp(new Date(iso));
  } catch {
    return iso;
  }
}

function kindLabel(kind: string): string {
  return kind.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

const STATION_META = {
  receiving: { label: 'Receiving', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', Icon: ClipboardList },
  packing: { label: 'Packing', tone: 'bg-sky-50 text-sky-700 ring-sky-200', Icon: Package },
  tech: { label: 'Tech', tone: 'bg-violet-50 text-violet-700 ring-violet-200', Icon: FileText },
  other: { label: 'Other', tone: 'bg-slate-100 text-slate-700 ring-slate-200', Icon: FileText },
} as const;

export function AuditLogStaffClient() {
  const searchParams = useSearchParams();
  const staffId = searchParams.get('staffId');
  const sharedQS = useSharedQS();

  const [detail, setDetail] = useState<StaffDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!staffId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = new URL('/api/audit-log/staff', window.location.origin);
    url.searchParams.set('staffId', staffId);
    if (sharedQS) for (const [k, v] of new URLSearchParams(sharedQS)) url.searchParams.set(k, v);
    fetch(url.toString(), { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.success) setDetail(d as StaffDetail);
        else setError(d?.error ?? 'Failed to load staff feed');
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [staffId, sharedQS]);

  if (!staffId) {
    return <AuditLogDailyReport section="staff" />;
  }
  if (loading) {
    return <CenterMessage label="Loading staff feed…" />;
  }
  if (error) {
    return <CenterMessage label={error} tone="error" />;
  }
  if (!detail || !detail.staff) {
    return <CenterMessage label="Staff not found." />;
  }

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
          Staff audit
        </p>
        <h2 className="mt-0.5 text-base font-bold text-gray-900">
          {detail.staff.name ?? `#${detail.staff.id}`}
        </h2>
        {detail.staff.role && (
          <p className="mt-1 text-[12px] text-gray-500">{detail.staff.role}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(['receiving', 'packing', 'tech'] as const).map((s) => {
            const meta = STATION_META[s];
            const n = detail.counts[s];
            if (!n) return null;
            return (
              <span
                key={s}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${meta.tone}`}
              >
                <meta.Icon className="h-3 w-3" />
                {meta.label}: {n}
              </span>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-3">
          {detail.events.length === 0 ? (
            <CenterMessage label="No events for this staff in the current range." />
          ) : (
            detail.events.map((ev) => <EventRow key={ev.id} event={ev} />)
          )}
        </div>
      </div>
    </section>
  );
}

function EventRow({ event }: { event: StaffEvent }) {
  const meta = STATION_META[event.station];
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${meta.tone}`}
            >
              <meta.Icon className="h-3 w-3" />
              {meta.label}
            </span>
            <span className="text-[11px] font-semibold text-gray-800">
              {kindLabel(event.kind)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500">
            {event.tracking && (
              <span className="font-mono text-[10px]">{event.tracking}</span>
            )}
            {event.sku && <span>SKU: {event.sku}</span>}
            {event.serial_number && (
              <span className="font-mono text-[10px] text-emerald-700">
                {event.serial_number}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-[10px] text-gray-400">{fmtTime(event.occurred_at)}</div>
      </div>
      {event.notes && (
        <p className="mt-2 whitespace-pre-wrap break-words text-[12px] text-gray-700">
          {event.notes}
        </p>
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
        className={`text-center text-[12px] ${
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
  for (const k of ['day', 'start', 'end', 'sku']) {
    const v = sp.get(k);
    if (v) next.set(k, v);
  }
  return next.toString();
}
