'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatPSTTimestamp } from '@/utils/date';
import { ClipboardList, Package, FileText, User as UserIcon } from '@/components/Icons';
import { AuditLogDailyReport } from './AuditLogDailyReport';

interface SkuEvent {
  id: string;
  occurred_at: string;
  source: 'inventory_event' | 'station_activity_log' | 'audit_log';
  station: 'receiving' | 'packing' | 'tech' | 'other';
  kind: string;
  actor_staff_id: number | null;
  actor_name: string | null;
  tracking: string | null;
  serial_number: string | null;
  notes: string | null;
  detail: Record<string, unknown>;
}

interface SkuDetail {
  sku: string;
  item_name: string | null;
  events: SkuEvent[];
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
  receiving: {
    label: 'Receiving',
    tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    Icon: ClipboardList,
  },
  packing: {
    label: 'Packing',
    tone: 'bg-sky-50 text-sky-700 ring-sky-200',
    Icon: Package,
  },
  tech: {
    label: 'Tech',
    tone: 'bg-violet-50 text-violet-700 ring-violet-200',
    Icon: FileText,
  },
  other: {
    label: 'Other',
    tone: 'bg-surface-sunken text-text-muted ring-border-soft',
    Icon: FileText,
  },
} as const;

export function AuditLogSkuClient() {
  const searchParams = useSearchParams();
  const sku = searchParams.get('sku');
  const sharedQS = useSharedQS();

  const [detail, setDetail] = useState<SkuDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sku) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = new URL('/api/audit-log/sku', window.location.origin);
    url.searchParams.set('sku', sku);
    if (sharedQS) for (const [k, v] of new URLSearchParams(sharedQS)) url.searchParams.set(k, v);
    fetch(url.toString(), { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.success) setDetail(d as SkuDetail);
        else setError(d?.error ?? 'Failed to load SKU detail');
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [sku, sharedQS]);

  if (!sku) {
    return <AuditLogDailyReport section="sku" />;
  }
  if (loading) {
    return <CenterMessage label="Loading SKU timeline…" />;
  }
  if (error) {
    return <CenterMessage label={error} tone="error" />;
  }
  if (!detail) {
    return <CenterMessage label="Pick a SKU from the sidebar." />;
  }

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-canvas">
      <div className="border-b border-border-soft bg-surface-card px-6 py-4">
        <p className="text-micro font-bold uppercase tracking-widest text-emerald-700">
          SKU audit
        </p>
        <h2 className="mt-0.5 font-mono text-base font-bold text-text-default">{detail.sku}</h2>
        {detail.item_name && (
          <p className="mt-1 text-label text-text-soft">{detail.item_name}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(['receiving', 'packing', 'tech'] as const).map((s) => {
            const meta = STATION_META[s];
            const n = detail.counts[s];
            if (!n) return null;
            return (
              <span
                key={s}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold ring-1 ${meta.tone}`}
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
            <CenterMessage label="No events match the current filters." />
          ) : (
            detail.events.map((ev) => <EventRow key={ev.id} event={ev} />)
          )}
        </div>
      </div>
    </section>
  );
}

function EventRow({ event }: { event: SkuEvent }) {
  const meta = STATION_META[event.station];
  return (
    <div className="rounded-xl border border-border-soft bg-surface-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-bold uppercase tracking-wider ring-1 ${meta.tone}`}
            >
              <meta.Icon className="h-3 w-3" />
              {meta.label}
            </span>
            <span className="text-caption font-semibold text-text-default">
              {kindLabel(event.kind)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-text-soft">
            <span className="inline-flex items-center gap-1">
              <UserIcon className="h-3 w-3" />
              {event.actor_name ?? (event.actor_staff_id ? `#${event.actor_staff_id}` : 'System')}
            </span>
            {event.tracking && (
              <span className="font-mono text-micro">{event.tracking}</span>
            )}
            {event.serial_number && (
              <span className="font-mono text-micro text-emerald-700">
                {event.serial_number}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-micro text-text-faint">{fmtTime(event.occurred_at)}</div>
      </div>
      {event.notes && (
        <p className="mt-2 whitespace-pre-wrap break-words text-label text-text-muted">
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
        className={`text-center text-label ${
          tone === 'error' ? 'text-rose-600' : 'text-text-faint'
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
  for (const k of ['day', 'start', 'end', 'staffId']) {
    const v = sp.get(k);
    if (v) next.set(k, v);
  }
  return next.toString();
}
