'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { usePersistedStaffId } from '@/hooks/usePersistedStaffId';

// ─── Types ──────────────────────────────────────────────────────────────────

interface SerialUnit {
  id: number;
  serial_number: string;
  normalized_serial: string;
  sku: string | null;
  current_status: string;
  current_location: string | null;
  condition_grade: string | null;
  origin_receiving_line_id: number | null;
  received_at: string | null;
  received_by: number | null;
  received_by_name: string | null;
  product_title: string | null;
}

interface TimelineEvent {
  id: number;
  occurred_at: string;
  event_type: string;
  actor_staff_id: number | null;
  station: string | null;
  prev_status: string | null;
  next_status: string | null;
  bin_id: number | null;
  prev_bin_id: number | null;
  receiving_line_id: number | null;
  payload: Record<string, unknown>;
  notes: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const STATUS_TONE: Record<string, string> = {
  UNKNOWN: 'bg-slate-100 text-slate-600',
  RECEIVED: 'bg-amber-100 text-amber-800',
  TESTED: 'bg-blue-100 text-blue-700',
  STOCKED: 'bg-emerald-100 text-emerald-700',
  PICKED: 'bg-indigo-100 text-indigo-700',
  SHIPPED: 'bg-violet-100 text-violet-700',
  RETURNED: 'bg-rose-100 text-rose-700',
  RMA: 'bg-rose-100 text-rose-700',
  SCRAPPED: 'bg-rose-100 text-rose-700',
};

function StatusPill({ status }: { status: string | null }) {
  const v = (status || 'UNKNOWN').toUpperCase();
  const tone = STATUS_TONE[v] || 'bg-slate-100 text-slate-600';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone}`}
    >
      {v}
    </span>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

function UnitPageInner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const unitParam = String(params?.id ?? '');
  const [staffId] = usePersistedStaffId();

  const [unit, setUnit] = useState<SerialUnit | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [binInput, setBinInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const load = useCallback(async () => {
    if (!unitParam) {
      setError('Missing unit id / serial');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/serial-units/${encodeURIComponent(unitParam)}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
      setUnit(data.serial_unit as SerialUnit);
      setEvents(Array.isArray(data.events) ? (data.events as TimelineEvent[]) : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load unit');
    } finally {
      setLoading(false);
    }
  }, [unitParam]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  const postStatus = useCallback(
    async (eventType: string) => {
      if (busy || !unit?.origin_receiving_line_id) return;
      setBusy(eventType);
      try {
        const res = await fetch(
          `/api/receiving/lines/${unit.origin_receiving_line_id}/status`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event_type: eventType,
              serial_unit_id: unit.id,
              staff_id: staffId,
              station: 'MOBILE',
              notes: noteInput.trim() || null,
              client_event_id: randomId(),
              scan_token: typeof window !== 'undefined' ? window.location.pathname : null,
            }),
          },
        );
        const data = await res.json();
        if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
        setFlash({ kind: 'ok', msg: `${eventType.replace(/_/g, ' ')} recorded` });
        setNoteInput('');
        await load();
      } catch (err) {
        setFlash({ kind: 'err', msg: err instanceof Error ? err.message : 'Failed' });
      } finally {
        setBusy(null);
      }
    },
    [busy, unit, staffId, noteInput, load],
  );

  const submitPutaway = useCallback(async () => {
    const bin = binInput.trim();
    if (!bin || busy || !unit?.origin_receiving_line_id) return;
    setBusy('putaway');
    try {
      const res = await fetch(
        `/api/receiving/lines/${unit.origin_receiving_line_id}/putaway`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bin_barcode: bin,
            qty: 1,
            serial_unit_id: unit.id,
            staff_id: staffId,
            station: 'MOBILE',
            client_event_id: randomId(),
            scan_token: typeof window !== 'undefined' ? window.location.pathname : null,
            notes: noteInput.trim() || null,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
      setFlash({ kind: 'ok', msg: `Stored in ${data.bin?.name ?? bin}` });
      setBinInput('');
      setNoteInput('');
      await load();
    } catch (err) {
      setFlash({ kind: 'err', msg: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setBusy(null);
    }
  }, [binInput, busy, unit, staffId, noteInput, load]);

  const lineHref = unit?.origin_receiving_line_id
    ? `/m/l/${unit.origin_receiving_line_id}?staffId=${staffId}`
    : null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between">
          {lineHref ? (
            <button
              type="button"
              onClick={() => router.push(lineHref)}
              className="text-xs font-bold text-blue-600"
            >
              ← Line
            </button>
          ) : (
            <span />
          )}
          <StatusPill status={unit?.current_status ?? null} />
        </div>
        <h1 className="mt-2 truncate font-mono text-base font-black text-slate-900">
          {unit?.serial_number || unitParam}
        </h1>
        {unit?.sku && (
          <p className="mt-1 font-mono text-[11px] font-bold text-slate-700">
            {unit.sku}
          </p>
        )}
        {unit?.product_title && (
          <p className="mt-1 text-[11px] text-slate-500 line-clamp-2 leading-snug">
            {unit.product_title}
          </p>
        )}
        <div className="mt-2 flex items-center justify-between text-[11px] font-bold">
          <span className="text-slate-700">
            {unit?.current_location ? `Loc: ${unit.current_location}` : 'No location'}
          </span>
          {unit?.condition_grade && (
            <span className="text-slate-500">
              {unit.condition_grade.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      </header>

      {flash && (
        <div
          className={`px-4 py-2 text-sm font-bold text-center ${
            flash.kind === 'ok'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-rose-50 text-rose-700'
          }`}
        >
          {flash.msg}
        </div>
      )}

      <main className="flex-1 px-4 py-3 space-y-4 pb-24">
        {loading && (
          <p className="text-center text-sm font-semibold text-slate-500 py-6">
            Loading…
          </p>
        )}

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        {unit && (
          <>
            <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                Test status
              </p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={!!busy || !unit.origin_receiving_line_id}
                  onClick={() => postStatus('TEST_START')}
                  className="rounded-md bg-blue-600 px-3 py-3 text-sm font-bold text-white active:bg-blue-700 disabled:opacity-50"
                >
                  Start
                </button>
                <button
                  type="button"
                  disabled={!!busy || !unit.origin_receiving_line_id}
                  onClick={() => postStatus('TEST_PASS')}
                  className="rounded-md bg-emerald-600 px-3 py-3 text-sm font-bold text-white active:bg-emerald-700 disabled:opacity-50"
                >
                  Pass
                </button>
                <button
                  type="button"
                  disabled={!!busy || !unit.origin_receiving_line_id}
                  onClick={() => postStatus('TEST_FAIL')}
                  className="rounded-md bg-rose-600 px-3 py-3 text-sm font-bold text-white active:bg-rose-700 disabled:opacity-50"
                >
                  Fail
                </button>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                Stash in bin
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  placeholder="Scan or type bin"
                  value={binInput}
                  onChange={(e) => setBinInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitPutaway();
                  }}
                  className="flex-1 rounded-md border border-slate-300 px-3 py-3 text-base font-mono font-bold text-slate-900 focus:border-blue-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!binInput.trim() || !!busy || !unit.origin_receiving_line_id}
                  onClick={submitPutaway}
                  className="rounded-md bg-slate-900 px-4 py-3 text-sm font-bold text-white active:bg-slate-800 disabled:opacity-50"
                >
                  Stash
                </button>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                Note (optional)
              </p>
              <textarea
                rows={2}
                placeholder="e.g. Power button flaky"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                Lifecycle
              </p>
              {events.length === 0 ? (
                <p className="text-[11px] text-slate-500">No activity yet.</p>
              ) : (
                <ul className="space-y-2">
                  {events.map((ev) => (
                    <li key={ev.id} className="flex items-start gap-2 text-[11px]">
                      <span className="mt-[3px] inline-block h-1.5 w-1.5 rounded-full bg-slate-400 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-slate-900">
                          {ev.event_type.replace(/_/g, ' ')}
                          {ev.next_status ? (
                            <span className="ml-1 text-slate-500">→ {ev.next_status}</span>
                          ) : null}
                        </p>
                        <p className="text-slate-500">
                          {formatAgo(ev.occurred_at)} ago
                          {ev.station ? ` · ${ev.station}` : ''}
                        </p>
                        {ev.notes && (
                          <p className="mt-0.5 text-slate-500 italic">{ev.notes}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default function UnitPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <UnitPageInner />
    </Suspense>
  );
}
