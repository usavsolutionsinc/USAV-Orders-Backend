'use client';

/**
 * Reusable per-entity audit timeline. Fetches /api/audit/bin/[id] or
 * /api/audit/sku/[sku] depending on which prop is set and renders a
 * newest-first stream of events with actor, action, before/after diff,
 * scan_ref, bin/location code, and reason.
 *
 * Drops into the bin detail page and the SKU detail panel.
 */

import { useEffect, useMemo, useState } from 'react';

interface EntityAuditEvent {
  id: string;
  occurred_at: string;
  source: 'audit_log' | 'inventory_event' | 'sku_stock_ledger';
  kind: string;
  actor_staff_id: number | null;
  actor_name: string | null;
  station: string | null;
  sku: string | null;
  bin_id: number | null;
  bin_name: string | null;
  bin_code: string | null;
  location_code: string | null;
  scan_ref: string | null;
  reason_code: string | null;
  note: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  detail: Record<string, unknown>;
}

interface Props {
  /** Pass exactly one of `binId` or `sku`. */
  binId?: number;
  sku?: string;
  /** Optional cap; defaults to 200. */
  limit?: number;
  /** When true, hides the section header (caller provides its own). */
  noHeader?: boolean;
  /** Compact mode trims vertical padding for tight panels. */
  compact?: boolean;
}

const SOURCE_BADGE: Record<EntityAuditEvent['source'], string> = {
  audit_log:        'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  inventory_event:  'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  sku_stock_ledger: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
};

const SOURCE_LABEL: Record<EntityAuditEvent['source'], string> = {
  audit_log:        'EDIT',
  inventory_event:  'LIFECYCLE',
  sku_stock_ledger: 'LEDGER',
};

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function fmtAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Date.now() - then;
  if (diff < 0) return 'just now';
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
}

function diffSummary(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  if (!before && !after) return [];
  const keys = new Set<string>([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  const out: string[] = [];
  for (const k of keys) {
    const b = before?.[k];
    const a = after?.[k];
    if (b === a) continue;
    if (b == null && a == null) continue;
    if (b == null) {
      out.push(`${k}: → ${fmtVal(a)}`);
    } else if (a == null) {
      out.push(`${k}: ${fmtVal(b)} →`);
    } else {
      out.push(`${k}: ${fmtVal(b)} → ${fmtVal(a)}`);
    }
  }
  return out;
}

function fmtVal(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

export function AuditTimeline(props: Props) {
  const { binId, sku, limit = 200, noHeader = false, compact = false } = props;
  const [events, setEvents] = useState<EntityAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const url = useMemo(() => {
    if (binId != null) return `/api/audit/bin/${binId}?limit=${limit}`;
    if (sku) return `/api/audit/sku/${encodeURIComponent(sku)}?limit=${limit}`;
    return null;
  }, [binId, sku, limit]);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void (async () => {
      try {
        const r = await fetch(url, { credentials: 'include', cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { events?: EntityAuditEvent[] };
        if (!cancelled) setEvents(data.events ?? []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (!url) {
    return <div className="text-xs text-gray-400">Pass binId or sku.</div>;
  }

  return (
    <section className={compact ? 'space-y-2' : 'space-y-3'}>
      {!noHeader && (
        <header className="flex items-baseline justify-between">
          <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
            History
          </h2>
          {!loading && events.length > 0 && (
            <span className="text-[10px] text-slate-400">{events.length} events</span>
          )}
        </header>
      )}

      {loading && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">
          Loading history…
        </div>
      )}

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {err}
        </div>
      )}

      {!loading && !err && events.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-400">
          No history yet.
        </div>
      )}

      {!loading && !err && events.length > 0 && (
        <ol className="rounded-lg border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100">
          {events.map((ev) => {
            const diffs = diffSummary(ev.before, ev.after);
            return (
              <li
                key={ev.id}
                className={compact ? 'px-3 py-2' : 'px-3 py-2.5'}
              >
                <div className="min-w-0">
                  <span
                    className={`inline-block rounded-sm px-1.5 py-px text-[9px] font-bold uppercase tracking-wider ${SOURCE_BADGE[ev.source]}`}
                    title={ev.source}
                  >
                    {SOURCE_LABEL[ev.source]}
                  </span>
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-mono text-[12px] font-semibold text-slate-900">
                      {ev.kind}
                    </span>
                    {ev.sku && (
                      <span className="font-mono text-[11px] text-slate-600">
                        {ev.sku}
                      </span>
                    )}
                    {ev.bin_code && (
                      <span className="font-mono text-[11px] text-slate-600">
                        @ {ev.bin_code}
                      </span>
                    )}
                    {ev.reason_code && (
                      <span className="rounded-sm bg-slate-100 px-1 py-px text-[10px] text-slate-600">
                        {ev.reason_code}
                      </span>
                    )}
                  </div>

                  {diffs.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {diffs.map((d, i) => (
                        <li
                          key={i}
                          className="font-mono text-[11px] text-slate-700"
                        >
                          {d}
                        </li>
                      ))}
                    </ul>
                  )}

                  {ev.note && (
                    <p className="mt-1 text-[11px] italic text-slate-500">{ev.note}</p>
                  )}

                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500">
                    <span className="font-semibold text-slate-700">
                      {ev.actor_name ?? 'Unknown'}
                    </span>
                    <span title={fmtTime(ev.occurred_at)}>
                      · {fmtAgo(ev.occurred_at)} ago
                    </span>
                    {ev.station && (
                      <span className="font-mono">· {ev.station}</span>
                    )}
                    {ev.scan_ref && (
                      <span className="font-mono">· scan {ev.scan_ref}</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
