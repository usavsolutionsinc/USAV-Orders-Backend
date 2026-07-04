'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Package } from '@/components/Icons';
import { AuditLogDailyReport } from './AuditLogDailyReport';
import { AuditEventCard, AuditCenterMessage, fmtTime } from './AuditEventCard';

interface PackingEvent {
  id: string;
  occurred_at: string;
  source: 'packer_log' | 'station_activity_log' | 'audit_log' | 'photo' | 'inventory_event';
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
    return <AuditCenterMessage label="Loading packing timeline…" />;
  }
  if (error) {
    return <AuditCenterMessage label={error} tone="error" />;
  }
  if (!detail) {
    return <AuditCenterMessage label="Pick a tracking from the sidebar." />;
  }

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-canvas">
      <div className="border-b border-border-soft bg-surface-card px-6 py-4">
        <p className="text-micro font-bold uppercase tracking-widest text-emerald-700">
          Packing audit
        </p>
        <h2 className="mt-0.5 break-all font-mono text-base font-bold text-text-default">
          {detail.tracking}
        </h2>
        {detail.sku_summary && (
          <p className="mt-1 text-label text-text-soft">SKU: {detail.sku_summary}</p>
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
            <AuditCenterMessage label="No events match the current filters." />
          ) : (
            detail.events.map((ev) => <AuditEventCard key={ev.id} event={ev} />)
          )}
        </div>
      </div>
    </section>
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
