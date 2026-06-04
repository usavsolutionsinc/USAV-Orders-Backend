'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FileText } from '@/components/Icons';
import { AuditLogDailyReport } from './AuditLogDailyReport';
import { AuditEventCard, AuditCenterMessage } from './AuditEventCard';

interface TechEvent {
  id: string;
  occurred_at: string;
  source: 'tech_serial_number' | 'station_activity_log' | 'audit_log' | 'inventory_event';
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
    return <AuditCenterMessage label="Loading tech timeline…" />;
  }
  if (error) {
    return <AuditCenterMessage label={error} tone="error" />;
  }
  if (!detail) {
    return <AuditCenterMessage label="Pick a session from the sidebar." />;
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
            <AuditCenterMessage label="No events match the current filters." />
          ) : (
            detail.events.map((ev) => <AuditEventCard key={ev.id} event={ev} />)
          )}
        </div>
      </div>
    </section>
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
