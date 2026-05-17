'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AdminEmptyDetail } from './shared';

type UnifiedLogRow = {
  event_id: string;
  kind: 'AUDIT' | 'SAL';
  created_at: string;
  actor_staff_id: number | null;
  actor_name: string | null;
  actor_role: string | null;
  station: string | null;
  action: string;
  source: string | null;
  entity_type: string | null;
  entity_id: string | null;
  station_activity_log_id: number | null;
  notes: string | null;
  scan_ref: string | null;
  fnsku: string | null;
  detail_value: string | null;
  detail_route: string | null;
  metadata: Record<string, unknown> | null;
};

type LogKind = 'all' | 'audit' | 'sal';

function asKind(raw: string | null): LogKind {
  if (raw === 'audit' || raw === 'sal') return raw;
  return 'all';
}

function formatDateTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

interface AdminLogsTabProps {
  initialSearch?: string;
}

export function AdminLogsTab(_props: AdminLogsTabProps = {}) {
  const searchParams = useSearchParams();
  const search = searchParams.get('search') ?? '';
  const kind = asKind(searchParams.get('logKind'));
  const actorRaw = searchParams.get('actorStaffId');
  const actorStaffId = useMemo(() => {
    if (!actorRaw) return null;
    const n = Number(actorRaw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [actorRaw]);
  const selectedEventId = searchParams.get('eventId') ?? '';

  const [offset] = useState(0);

  // Same key as the sidebar's query so we share the cache; sidebar drives
  // pagination so we just read whatever it last loaded.
  const query = useQuery({
    queryKey: ['admin-logs', { search, kind, actorStaffId, offset }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('limit', '100');
      params.set('offset', '0');
      if (search.trim()) params.set('q', search.trim());
      if (kind !== 'all') params.set('kind', kind);
      if (actorStaffId != null) params.set('actorStaffId', String(actorStaffId));
      const res = await fetch(`/api/admin/logs?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load admin logs');
      return {
        rows: (Array.isArray(data?.rows) ? data.rows : []) as UnifiedLogRow[],
      };
    },
  });

  const event = useMemo(
    () => query.data?.rows.find((r) => r.event_id === selectedEventId) ?? null,
    [query.data, selectedEventId],
  );

  if (!selectedEventId) {
    return (
      <AdminEmptyDetail
        title="Pick an event"
        hint="Select an audit or station activity log entry from the left to see its full envelope."
      />
    );
  }

  if (query.isLoading) {
    return <AdminEmptyDetail title="Loading event…" />;
  }

  if (!event) {
    return (
      <AdminEmptyDetail
        title="Event not found"
        hint="It may have scrolled off this page. Try clearing filters or paging back."
      />
    );
  }

  const actorLabel = event.actor_name?.trim()
    ? `${event.actor_name} (#${event.actor_staff_id ?? '-'})`
    : event.actor_staff_id != null
      ? `#${event.actor_staff_id}`
      : 'System';

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-gray-50">
      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-5">
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                {event.kind} event
              </p>
              <h2 className="mt-0.5 break-words text-lg font-bold text-gray-900">
                {event.action}
              </h2>
              <p className="mt-0.5 break-all font-mono text-[11px] text-gray-400">
                {event.event_id}
              </p>
            </div>
            <span
              className={`inline-flex flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                event.kind === 'AUDIT'
                  ? 'bg-blue-50 text-blue-700'
                  : 'bg-purple-50 text-purple-700'
              }`}
            >
              {event.kind}
            </span>
          </header>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <DetailCard label="When" value={formatDateTime(event.created_at)} />
            <DetailCard label="Actor" value={actorLabel} />
            <DetailCard label="Role" value={event.actor_role ?? '-'} />
            <DetailCard label="Station" value={event.station ?? '-'} />
            <DetailCard label="Source" value={event.source ?? '-'} />
            <DetailCard
              label="Entity"
              value={event.entity_type ? `${event.entity_type}:${event.entity_id ?? ''}` : '-'}
            />
          </div>

          {(event.detail_value || event.detail_route) && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Detail</p>
              {event.detail_value ? (
                <p className="mt-1 break-words text-[13px] text-gray-900">{event.detail_value}</p>
              ) : null}
              {event.detail_route ? (
                <a
                  href={event.detail_route}
                  className="mt-2 inline-block text-[12px] font-semibold text-blue-600 hover:underline"
                >
                  Open route →
                </a>
              ) : null}
            </div>
          )}

          {event.notes ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Notes</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-gray-900">
                {event.notes}
              </p>
            </div>
          ) : null}

          {(event.scan_ref || event.fnsku) && (
            <div className="grid grid-cols-2 gap-3">
              {event.scan_ref ? <DetailCard label="Scan ref" value={event.scan_ref} /> : null}
              {event.fnsku ? <DetailCard label="FNSKU" value={event.fnsku} /> : null}
            </div>
          )}

          {event.metadata && Object.keys(event.metadata).length > 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Metadata</p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-gray-50 p-3 text-[11px] text-gray-800">
                {JSON.stringify(event.metadata, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function DetailCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">{label}</p>
      <div className="mt-1 break-words text-[13px] font-semibold text-gray-900">{value}</div>
    </div>
  );
}
