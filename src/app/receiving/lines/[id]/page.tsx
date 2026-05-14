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
}

interface LineDetail {
  id: number;
  receiving_id: number | null;
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

interface TimelineEvent {
  id: number;
  occurred_at: string;
  event_type: string;
  actor_name: string | null;
  station: string | null;
  bin_name: string | null;
  prev_bin_name: string | null;
  prev_status: string | null;
  next_status: string | null;
  serial_number: string | null;
  notes: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const STATUS_TONE: Record<string, string> = {
  EXPECTED: 'bg-slate-100 text-slate-600',
  ARRIVED: 'bg-amber-100 text-amber-800',
  MATCHED: 'bg-amber-100 text-amber-800',
  UNBOXED: 'bg-amber-100 text-amber-800',
  AWAITING_TEST: 'bg-blue-100 text-blue-700',
  IN_TEST: 'bg-blue-100 text-blue-700',
  PASSED: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-rose-100 text-rose-700',
  DONE: 'bg-emerald-100 text-emerald-700',
  RTV: 'bg-rose-100 text-rose-700',
  SCRAP: 'bg-rose-100 text-rose-700',
};

function StatusPill({ status }: { status: string | null }) {
  const v = (status || 'EXPECTED').toUpperCase();
  const tone = STATUS_TONE[v] || 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone}`}>
      {workflowStatusTableLabel(status || 'EXPECTED')}
    </span>
  );
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

// ─── Page ───────────────────────────────────────────────────────────────────

function LinePageInner() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const lineId = Number(params?.id);
  const [staffId] = usePersistedStaffId();

  const [line, setLine] = useState<LineDetail | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // which action in flight

  const [serialInput, setSerialInput] = useState('');
  const [binInput, setBinInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const loadAll = useCallback(async () => {
    if (!Number.isFinite(lineId) || lineId <= 0) {
      setError('Invalid line id');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [lineRes, timelineRes] = await Promise.all([
        fetch(`/api/receiving-lines?id=${lineId}&include=serials`, { cache: 'no-store' }),
        fetch(`/api/receiving/lines/${lineId}/timeline?limit=30`, { cache: 'no-store' }),
      ]);
      const lineData = await lineRes.json();
      const timelineData = await timelineRes.json();
      if (!lineRes.ok) throw new Error(lineData?.error || `HTTP ${lineRes.status}`);
      const rows = Array.isArray(lineData?.receiving_lines) ? lineData.receiving_lines : [];
      setLine(rows[0] ?? null);
      setEvents(
        timelineData?.success && Array.isArray(timelineData.events) ? timelineData.events : [],
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load line');
    } finally {
      setLoading(false);
    }
  }, [lineId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Auto-clear flash after 2.5s.
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  // ─── Actions ──────────────────────────────────────────────────────────────

  const postStatus = useCallback(
    async (eventType: string) => {
      if (busy) return;
      setBusy(eventType);
      try {
        const res = await fetch(`/api/receiving/lines/${lineId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_type: eventType,
            staff_id: staffId,
            station: 'MOBILE',
            notes: noteInput.trim() || null,
            client_event_id: randomId(),
            scan_token: typeof window !== 'undefined' ? window.location.pathname : null,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
        setFlash({ kind: 'ok', msg: `${eventType.replace(/_/g, ' ')} recorded` });
        setNoteInput('');
        await loadAll();
      } catch (err) {
        setFlash({
          kind: 'err',
          msg: err instanceof Error ? err.message : 'Failed',
        });
      } finally {
        setBusy(null);
      }
    },
    [busy, lineId, staffId, noteInput, loadAll],
  );

  const submitSerial = useCallback(async () => {
    const serial = serialInput.trim();
    if (!serial || busy) return;
    setBusy('serial');
    try {
      const res = await fetch('/api/receiving/scan-serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiving_line_id: lineId,
          serial_number: serial,
          staff_id: staffId,
          station: 'MOBILE',
          client_event_id: randomId(),
          scan_token: typeof window !== 'undefined' ? window.location.pathname : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
      setFlash({
        kind: 'ok',
        msg: data?.is_return ? `Return detected: ${serial}` : `Serial ${serial} recorded`,
      });
      setSerialInput('');
      await loadAll();
    } catch (err) {
      setFlash({
        kind: 'err',
        msg: err instanceof Error ? err.message : 'Failed to scan serial',
      });
    } finally {
      setBusy(null);
    }
  }, [serialInput, busy, lineId, staffId, loadAll]);

  const submitPutaway = useCallback(async () => {
    const bin = binInput.trim();
    if (!bin || busy) return;
    setBusy('putaway');
    try {
      const res = await fetch(`/api/receiving/lines/${lineId}/putaway`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bin_barcode: bin,
          qty: 1,
          staff_id: staffId,
          station: 'MOBILE',
          client_event_id: randomId(),
          scan_token: typeof window !== 'undefined' ? window.location.pathname : null,
          notes: noteInput.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
      setFlash({ kind: 'ok', msg: `Stored in ${data.bin?.name ?? bin}` });
      setBinInput('');
      setNoteInput('');
      await loadAll();
    } catch (err) {
      setFlash({
        kind: 'err',
        msg: err instanceof Error ? err.message : 'Failed to putaway',
      });
    } finally {
      setBusy(null);
    }
  }, [binInput, busy, lineId, staffId, noteInput, loadAll]);

  // ─── Render ───────────────────────────────────────────────────────────────

  const expected = line?.quantity_expected ?? null;
  const received = line?.quantity_received ?? 0;
  const isComplete = expected != null && received >= expected;

  const cartonHref = line?.receiving_id
    ? `/m/r/${line.receiving_id}?staffId=${staffId}`
    : null;

  const serials = useMemo(() => line?.serials ?? [], [line]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between">
          {cartonHref ? (
            <button
              type="button"
              onClick={() => router.push(cartonHref)}
              className="text-xs font-bold text-blue-600"
            >
              ← Carton
            </button>
          ) : (
            <span />
          )}
          <StatusPill status={line?.workflow_status ?? null} />
        </div>
        <h1 className="mt-2 truncate font-mono text-base font-black text-slate-900">
          {line?.sku || `Line #${lineId}`}
        </h1>
        {line?.item_name && (
          <p className="mt-1 text-[11px] text-slate-500 line-clamp-2 leading-snug">
            {line.item_name}
          </p>
        )}
        <div className="mt-2 flex items-center justify-between text-[11px] font-bold">
          <span className={isComplete ? 'text-emerald-600' : 'text-slate-700'}>
            {received}/{expected ?? '?'} received
          </span>
          {line?.condition_grade && (
            <span className="text-slate-500">
              Cond: {line.condition_grade.replace(/_/g, ' ')}
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

        {/* Test actions */}
        <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            Test status
          </p>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => postStatus('TEST_START')}
              className="rounded-md bg-blue-600 px-3 py-3 text-sm font-bold text-white active:bg-blue-700 disabled:opacity-50"
            >
              Start
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => postStatus('TEST_PASS')}
              className="rounded-md bg-emerald-600 px-3 py-3 text-sm font-bold text-white active:bg-emerald-700 disabled:opacity-50"
            >
              Pass
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => postStatus('TEST_FAIL')}
              className="rounded-md bg-rose-600 px-3 py-3 text-sm font-bold text-white active:bg-rose-700 disabled:opacity-50"
            >
              Fail
            </button>
          </div>
        </section>

        {/* Serial scan */}
        <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            Scan serial
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="Scan or type serial"
              value={serialInput}
              onChange={(e) => setSerialInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitSerial();
              }}
              className="flex-1 rounded-md border border-slate-300 px-3 py-3 text-base font-mono font-bold text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={!serialInput.trim() || !!busy}
              onClick={submitSerial}
              className="rounded-md bg-slate-900 px-4 py-3 text-sm font-bold text-white active:bg-slate-800 disabled:opacity-50"
            >
              Add
            </button>
          </div>
          {serials.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {serials.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-700"
                >
                  {s.serial_number}
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-500">{s.current_status}</span>
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Putaway */}
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
              disabled={!binInput.trim() || !!busy}
              onClick={submitPutaway}
              className="rounded-md bg-slate-900 px-4 py-3 text-sm font-bold text-white active:bg-slate-800 disabled:opacity-50"
            >
              Stash
            </button>
          </div>
        </section>

        {/* Note (optional, applied to next action) */}
        <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            Note (optional, attached to next action)
          </p>
          <textarea
            rows={2}
            placeholder="e.g. Power button flaky"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
          />
        </section>

        {/* Timeline */}
        <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            Recent activity
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
                      {ev.bin_name ? (
                        <span className="ml-1 font-semibold text-slate-600">
                          → {ev.bin_name}
                        </span>
                      ) : null}
                      {ev.serial_number ? (
                        <span className="ml-1 font-mono text-slate-500">
                          · {ev.serial_number}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-slate-500">
                      {ev.actor_name || 'Unknown'} · {formatAgo(ev.occurred_at)} ago
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
      </main>
    </div>
  );
}

export default function LinePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <LinePageInner />
    </Suspense>
  );
}
