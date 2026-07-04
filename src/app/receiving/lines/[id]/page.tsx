'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { safeRandomUUID } from '@/lib/safe-uuid';
import {
  workflowStatusTableLabel,
  conditionGradeTableLabel,
  conditionBadgeTone,
  unitStatusBadgeTone,
  getStatusDotBg,
} from '@/components/station/receiving-constants';
import { workflowStageBadge } from '@/lib/receiving/workflow-stages';
import { getLast4 } from '@/components/ui/CopyChip';
import { ReceivingIdentityChips } from '@/components/receiving/ReceivingIdentityChips';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { ScanAgainBar } from '@/components/mobile/receiving/ScanAgainBar';
import { Button } from '@/design-system/primitives';

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
  return safeRandomUUID();
}

function StatusPill({ status }: { status: string | null }) {
  const v = status || 'EXPECTED';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-micro font-bold uppercase tracking-wide ${workflowStageBadge(v)}`}>
      {workflowStatusTableLabel(v)}
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
  // Identity from the verified session cookie (proxy guarantees a user
  // by the time this page renders).
  const { user } = useAuth();
  const staffId = user?.staffId ?? 0;

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
      const rows = Array.isArray(lineData?.receiving_lines)
        ? lineData.receiving_lines
        : lineData?.receiving_line
          ? [lineData.receiving_line]
          : [];
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

  const cartonHref = line?.receiving_id ? `/m/r/${line.receiving_id}` : null;

  const serials = useMemo(() => line?.serials ?? [], [line]);

  return (
    <div className="min-h-screen bg-surface-canvas flex flex-col">
      <header className="sticky top-0 z-10 bg-surface-card border-b border-border-soft px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          {cartonHref ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(cartonHref)}
              className="shrink-0 text-blue-600 hover:text-blue-700"
            >
              ← Package
            </Button>
          ) : (
            <span />
          )}
          <ScanAgainBar />
        </div>

        {/* Slim identity row — mirrors the desktop ReceivingLineOrderRow:
            status dot + title, then a color-coded status/condition/qty line. */}
        <div className="mt-2 flex min-w-0 items-center gap-2">
          <HoverTooltip
            label={workflowStatusTableLabel(line?.workflow_status ?? 'EXPECTED')}
            asChild
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${getStatusDotBg(line?.workflow_status, received, expected)}`}
            />
          </HoverTooltip>
          <h1 className="truncate text-sm font-bold text-text-default">
            {line?.item_name || line?.sku || `Line #${lineId}`}
          </h1>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-4">
          <StatusPill status={line?.workflow_status ?? null} />
          {line?.condition_grade && (
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-micro font-bold uppercase tracking-wide ${conditionBadgeTone(line.condition_grade)}`}>
              {conditionGradeTableLabel(line.condition_grade)}
            </span>
          )}
          <span
            className={`text-caption font-black uppercase tracking-widest ${isComplete ? 'text-emerald-600' : 'text-text-muted'}`}
          >
            {received}/{expected ?? '?'}
          </span>
        </div>

        {/* Shared last-4 chips — PO + SKU + most-recent serial (tap to copy). */}
        <ReceivingIdentityChips
          po={line?.zoho_purchaseorder_number}
          sku={line?.sku}
          serialsCsv={(serials ?? []).map((s) => s.serial_number).filter(Boolean).join(', ')}
          includeTracking={false}
          includeSerial={serials.length > 0}
          className="mt-2 flex flex-wrap items-center gap-1.5 pl-4"
        />
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
          <p className="text-center text-sm font-semibold text-text-soft py-6">
            Loading…
          </p>
        )}

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        {/* Test actions */}
        <section className="rounded-lg border border-border-soft bg-surface-card p-3 shadow-sm">
          <p className="mb-2 text-micro font-black uppercase tracking-[0.16em] text-text-soft">
            Test status
          </p>
          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="primary"
              size="lg"
              disabled={!!busy}
              onClick={() => postStatus('TEST_START')}
              className="h-12 w-full"
            >
              Start
            </Button>
            <Button
              variant="primary"
              size="lg"
              disabled={!!busy}
              onClick={() => postStatus('TEST_PASS')}
              className="h-12 w-full bg-emerald-600 shadow-emerald-600/25 hover:bg-emerald-500 active:bg-emerald-700"
            >
              Pass
            </Button>
            <Button
              variant="danger"
              size="lg"
              disabled={!!busy}
              onClick={() => postStatus('TEST_FAIL')}
              className="h-12 w-full"
            >
              Fail
            </Button>
          </div>
        </section>

        {/* Serial scan */}
        <section className="rounded-lg border border-border-soft bg-surface-card p-3 shadow-sm">
          <p className="mb-2 text-micro font-black uppercase tracking-[0.16em] text-text-soft">
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
              className="flex-1 rounded-md border border-border-default px-3 py-3 text-base font-mono font-bold text-text-default focus:border-blue-500 focus:outline-none"
            />
            <Button
              variant="brand"
              size="lg"
              disabled={!serialInput.trim() || !!busy}
              onClick={submitSerial}
              className="h-12"
            >
              Add
            </Button>
          </div>
          {serials.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {serials.map((s) => (
                // ds-allow-title: non-interactive chip showing the clipped last-4 serial; title reveals the full serial.
                <span
                  key={s.id}
                  title={s.serial_number}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-micro font-bold ${unitStatusBadgeTone(s.current_status)}`}
                >
                  …{getLast4(s.serial_number)}
                  <span className="opacity-50">·</span>
                  <span className="opacity-80">{s.current_status}</span>
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Putaway */}
        <section className="rounded-lg border border-border-soft bg-surface-card p-3 shadow-sm">
          <p className="mb-2 text-micro font-black uppercase tracking-[0.16em] text-text-soft">
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
              className="flex-1 rounded-md border border-border-default px-3 py-3 text-base font-mono font-bold text-text-default focus:border-blue-500 focus:outline-none"
            />
            <Button
              variant="brand"
              size="lg"
              disabled={!binInput.trim() || !!busy}
              onClick={submitPutaway}
              className="h-12"
            >
              Stash
            </Button>
          </div>
        </section>

        {/* Note (optional, applied to next action) */}
        <section className="rounded-lg border border-border-soft bg-surface-card p-3 shadow-sm">
          <p className="mb-2 text-micro font-black uppercase tracking-[0.16em] text-text-soft">
            Note (optional, attached to next action)
          </p>
          <textarea
            rows={2}
            placeholder="e.g. Power button flaky"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            className="w-full rounded-md border border-border-default px-3 py-2 text-sm text-text-default focus:border-blue-500 focus:outline-none"
          />
        </section>

        {/* Timeline */}
        <section className="rounded-lg border border-border-soft bg-surface-card p-3 shadow-sm">
          <p className="mb-2 text-micro font-black uppercase tracking-[0.16em] text-text-soft">
            Recent activity
          </p>
          {events.length === 0 ? (
            <p className="text-caption text-text-soft">No activity yet.</p>
          ) : (
            <ul className="space-y-2">
              {events.map((ev) => (
                <li key={ev.id} className="flex items-start gap-2 text-caption">
                  <span className="mt-[3px] inline-block h-1.5 w-1.5 rounded-full bg-border-emphasis shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-text-default">
                      {ev.event_type.replace(/_/g, ' ')}
                      {ev.bin_name ? (
                        <span className="ml-1 font-semibold text-text-muted">
                          → {ev.bin_name}
                        </span>
                      ) : null}
                      {ev.serial_number ? (
                        <span className="ml-1 font-mono text-text-soft">
                          · {ev.serial_number}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-text-soft">
                      {ev.actor_name || 'Unknown'} · {formatAgo(ev.occurred_at)} ago
                      {ev.station ? ` · ${ev.station}` : ''}
                    </p>
                    {ev.notes && (
                      <p className="mt-0.5 text-text-soft italic">{ev.notes}</p>
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
    <Suspense fallback={<div className="min-h-screen bg-surface-canvas" />}>
      <LinePageInner />
    </Suspense>
  );
}
