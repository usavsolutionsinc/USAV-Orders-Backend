'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { usePersistedStaffId } from '@/hooks/usePersistedStaffId';
import { workflowStatusTableLabel } from '@/components/station/receiving-constants';

// ─── Types ──────────────────────────────────────────────────────────────────

interface SerialChip {
  id: number;
  serial_number: string;
  current_status: string;
  current_location: string | null;
}

interface LineRow {
  id: number;
  sku: string | null;
  item_name: string | null;
  quantity_expected: number | null;
  quantity_received: number;
  workflow_status: string | null;
  qa_status: string | null;
  condition_grade: string | null;
  zoho_purchaseorder_number: string | null;
  serials?: SerialChip[];
}

interface PoRef {
  zoho_purchaseorder_id: string;
  zoho_purchaseorder_number: string | null;
  line_count: number;
}

interface Carton {
  id: number;
  tracking: string | null;
  carrier: string | null;
  source_platform: string | null;
  is_return: boolean;
  return_platform: string | null;
  return_reason: string | null;
  target_channel: string | null;
  qa_status: string | null;
  disposition_code: string | null;
  condition_grade: string | null;
  received_at: string | null;
  unboxed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  needs_test: boolean;
}

interface Totals {
  expected: number;
  received: number;
  lines: number;
  lines_complete: number;
}

interface TimelineEvent {
  id: number;
  occurred_at: string;
  event_type: string;
  actor_name: string | null;
  station: string | null;
  bin_name: string | null;
  serial_number: string | null;
  prev_status: string | null;
  next_status: string | null;
  receiving_line_id: number | null;
  sku: string | null;
  notes: string | null;
}

interface FullCarton {
  receiving: Carton;
  purchase_orders: PoRef[];
  lines: LineRow[];
  totals: Totals;
  events: TimelineEvent[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<string, string> = {
  EXPECTED: 'bg-slate-100 text-slate-600',
  ARRIVED: 'bg-amber-100 text-amber-800',
  MATCHED: 'bg-amber-100 text-amber-800',
  UNBOXED: 'bg-amber-100 text-amber-800',
  AWAITING_TEST: 'bg-blue-100 text-blue-700',
  IN_TEST: 'bg-blue-100 text-blue-700',
  PASSED: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-rose-100 text-rose-700',
  RTV: 'bg-rose-100 text-rose-700',
  SCRAP: 'bg-rose-100 text-rose-700',
  DONE: 'bg-emerald-100 text-emerald-700',
  RECEIVED: 'bg-emerald-100 text-emerald-700',
};

function StatusPill({ status }: { status: string | null }) {
  const v = (status || 'EXPECTED').toUpperCase();
  const tone = STATUS_TONE[v] || 'bg-slate-100 text-slate-600';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone}`}
    >
      {workflowStatusTableLabel(status || 'EXPECTED')}
    </span>
  );
}

function formatDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });
}

function formatAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const SOURCE_LABEL: Record<string, string> = {
  ebay: 'eBay',
  amazon: 'Amazon',
  aliexpress: 'AliExpress',
  walmart: 'Walmart',
  goodwill: 'Goodwill',
  other: 'Other',
  zoho: 'Zoho',
};

function platformLabel(c: Carton): string {
  const sp = (c.source_platform || '').toLowerCase();
  if (sp) return SOURCE_LABEL[sp] || sp;
  if (c.is_return) {
    return c.return_platform
      ? `Return · ${c.return_platform.replace(/_/g, ' ')}`
      : 'Return';
  }
  return 'PO';
}

// ─── Page ───────────────────────────────────────────────────────────────────

function CartonPageInner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const receivingId = Number(params?.id);
  const [staffId] = usePersistedStaffId();

  const [data, setData] = useState<FullCarton | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!Number.isFinite(receivingId) || receivingId <= 0) {
      setError('Invalid carton id');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/receiving/${receivingId}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok || !body?.success) throw new Error(body?.error || `HTTP ${res.status}`);
      setData(body as FullCarton);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load carton');
    } finally {
      setLoading(false);
    }
  }, [receivingId]);

  useEffect(() => {
    load();
  }, [load]);

  const carton = data?.receiving;
  const lines = useMemo(() => data?.lines ?? [], [data]);
  const events = useMemo(() => data?.events ?? [], [data]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
              Carton
            </p>
            <h1 className="truncate text-lg font-black text-slate-900">
              RCV-{receivingId}
            </h1>
            {data?.purchase_orders && data.purchase_orders.length > 0 ? (
              <p className="mt-0.5 truncate font-mono text-[11px] font-bold text-slate-600">
                PO{' '}
                {data.purchase_orders
                  .map((p) => p.zoho_purchaseorder_number || p.zoho_purchaseorder_id)
                  .join(', ')}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {carton ? (
              <span className="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                {platformLabel(carton)}
              </span>
            ) : null}
            <button
              type="button"
              onClick={load}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 active:bg-slate-50"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-3 space-y-3 pb-24">
        {loading && (
          <p className="text-center text-sm font-semibold text-slate-500 py-10">
            Loading…
          </p>
        )}

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        {/* ─── Carton metadata block ─── */}
        {!loading && carton && (
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
            <Row
              label="Tracking"
              value={
                carton.tracking ? (
                  <span className="font-mono">{carton.tracking}</span>
                ) : (
                  <span className="text-slate-400">—</span>
                )
              }
              hint={carton.carrier}
            />
            <Row
              label="Received"
              value={formatDate(carton.received_at || carton.created_at)}
              hint={
                carton.unboxed_at
                  ? `Unboxed ${formatDate(carton.unboxed_at)}`
                  : null
              }
            />
            {data && (
              <Row
                label="Progress"
                value={
                  <span>
                    <span className="font-mono font-black">
                      {data.totals.received}
                    </span>
                    <span className="text-slate-400"> / </span>
                    <span className="font-mono">{data.totals.expected || '?'}</span>
                    <span className="ml-1 text-slate-500">units</span>
                  </span>
                }
                hint={`${data.totals.lines_complete}/${data.totals.lines} lines complete`}
              />
            )}
            {carton.return_platform && (
              <Row
                label="Return platform"
                value={carton.return_platform.replace(/_/g, ' ')}
                hint={carton.return_reason ?? null}
              />
            )}
            {carton.target_channel && (
              <Row label="Target channel" value={carton.target_channel} hint={null} />
            )}
            {carton.qa_status && carton.qa_status !== 'PENDING' && (
              <Row
                label="QA"
                value={carton.qa_status.replace(/_/g, ' ')}
                hint={carton.condition_grade?.replace(/_/g, ' ') ?? null}
              />
            )}
          </section>
        )}

        {/* ─── Lines (the bundle split — one card per part) ─── */}
        {!loading && lines.length > 0 && (
          <section>
            <p className="px-1 mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
              Lines ({lines.length})
            </p>
            <div className="space-y-2">
              {lines.map((line) => {
                const expected = line.quantity_expected ?? null;
                const received = line.quantity_received ?? 0;
                const isComplete = expected != null && received >= expected;
                return (
                  <button
                    key={line.id}
                    type="button"
                    onClick={() => router.push(`/m/l/${line.id}?staffId=${staffId}`)}
                    className="block w-full text-left rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm active:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-black text-slate-900 truncate">
                          {line.sku || `Line #${line.id}`}
                        </p>
                        {line.item_name && (
                          <p className="mt-1 text-[11px] text-slate-500 line-clamp-2 leading-snug">
                            {line.item_name}
                          </p>
                        )}
                      </div>
                      <StatusPill status={line.workflow_status} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] font-bold">
                      <span className={isComplete ? 'text-emerald-600' : 'text-slate-700'}>
                        {received}/{expected ?? '?'} received
                      </span>
                      {line.serials && line.serials.length > 0 && (
                        <span className="text-slate-500">
                          {line.serials.length} serial
                          {line.serials.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    {line.serials && line.serials.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {line.serials.slice(0, 4).map((s) => (
                          <span
                            key={s.id}
                            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-700"
                          >
                            {s.serial_number}
                            {s.current_location ? (
                              <span className="text-slate-400">· {s.current_location}</span>
                            ) : null}
                          </span>
                        ))}
                        {line.serials.length > 4 && (
                          <span className="text-[10px] font-bold text-slate-500">
                            +{line.serials.length - 4} more
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {!loading && lines.length === 0 && (
          <p className="text-center text-sm font-semibold text-slate-500 py-10">
            No lines on this carton yet.
          </p>
        )}

        {/* ─── Recent activity timeline ─── */}
        {!loading && events.length > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
              Recent activity ({events.length})
            </p>
            <ul className="space-y-2">
              {events.slice(0, 15).map((ev) => (
                <li key={ev.id} className="flex items-start gap-2 text-[11px]">
                  <span className="mt-[3px] inline-block h-1.5 w-1.5 rounded-full bg-slate-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-900">
                      {ev.event_type.replace(/_/g, ' ')}
                      {ev.sku ? (
                        <span className="ml-1 font-mono text-slate-600">
                          · {ev.sku}
                        </span>
                      ) : null}
                      {ev.serial_number ? (
                        <span className="ml-1 font-mono text-slate-500">
                          · {ev.serial_number}
                        </span>
                      ) : null}
                      {ev.bin_name ? (
                        <span className="ml-1 font-semibold text-slate-600">
                          → {ev.bin_name}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-slate-500">
                      {ev.actor_name || 'Unknown'} · {formatAgo(ev.occurred_at)} ago
                      {ev.station ? ` · ${ev.station}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer className="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-3 text-[11px] font-semibold text-slate-500 text-center">
        Tap a line to update status, putaway, or scan serial.
      </footer>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint: string | null | undefined;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
      <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
        {label}
      </span>
      <div className="text-right min-w-0">
        <p className="truncate text-sm font-bold text-slate-900">{value}</p>
        {hint ? (
          <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-500">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function CartonPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <CartonPageInner />
    </Suspense>
  );
}
