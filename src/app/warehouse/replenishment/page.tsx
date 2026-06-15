'use client';

/**
 * /warehouse/replenishment — pick-face restock task queue.
 *
 * Surfaces every open `replenishment_tasks` row (REQUESTED + IN_PROGRESS).
 * Supervisors triage at the desktop; floor staff can claim/complete from
 * the same page on mobile.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { NetworkChip } from '@/components/mobile/NetworkChip';

interface TaskRow {
  id: number;
  sku: string;
  fromBinId: number | null;
  toBinId: number;
  qty: number;
  status: 'REQUESTED' | 'IN_PROGRESS' | 'COMPLETE' | 'CANCELED';
  detectedAt: string;
  assignedStaffId: number | null;
  qtyMoved: number | null;
}

const STATUS_TONE: Record<TaskRow['status'], string> = {
  REQUESTED:   'bg-amber-100   text-amber-800  border-amber-200',
  IN_PROGRESS: 'bg-blue-100    text-blue-800   border-blue-200',
  COMPLETE:    'bg-emerald-100 text-emerald-800 border-emerald-200',
  CANCELED:    'bg-slate-100   text-slate-600  border-slate-200',
};

export default function ReplenishmentPage() {
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<number | null>(null);

  const fetchTasks = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/replenishment/tasks', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setTasks(data.tasks);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'load failed';
      setError(message);
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const claim = async (taskId: number) => {
    setWorking(taskId);
    try {
      const res = await fetch(`/api/replenishment/tasks/${taskId}/claim`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await fetchTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'claim failed');
    } finally {
      setWorking(null);
    }
  };

  const complete = async (taskId: number, defaultQty: number) => {
    const input = window.prompt(`How many units did you move?`, String(defaultQty));
    if (input == null) return;
    const qty = Number(input);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Invalid quantity');
      return;
    }
    setWorking(taskId);
    try {
      const res = await fetch(`/api/replenishment/tasks/${taskId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty_moved: qty }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await fetchTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'complete failed');
    } finally {
      setWorking(null);
    }
  };

  const cancel = async (taskId: number) => {
    const reason = window.prompt('Cancel reason?');
    if (!reason || !reason.trim()) return;
    setWorking(taskId);
    try {
      const res = await fetch(`/api/replenishment/tasks/${taskId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await fetchTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'cancel failed');
    } finally {
      setWorking(null);
    }
  };

  const requested = useMemo(() => tasks?.filter((t) => t.status === 'REQUESTED') ?? [], [tasks]);
  const inProgress = useMemo(() => tasks?.filter((t) => t.status === 'IN_PROGRESS') ?? [], [tasks]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Warehouse</p>
          <h1 className="text-2xl font-bold text-slate-900">Replenishment</h1>
          <p className="mt-1 text-sm text-slate-500">
            Move stock from RESERVE to PICK_FACE bins when forward stock runs low.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <NetworkChip />
          <button
            type="button"
            onClick={() => void fetchTasks()}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {tasks == null ? (
        <LoadingRow />
      ) : tasks.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Section
            title="Awaiting claim"
            count={requested.length}
            tone="amber"
            tasks={requested}
            actionLabel="Claim"
            onAction={(t) => void claim(t.id)}
            onCancel={(t) => void cancel(t.id)}
            working={working}
          />
          <Section
            title="In progress"
            count={inProgress.length}
            tone="blue"
            tasks={inProgress}
            actionLabel="Complete…"
            onAction={(t) => void complete(t.id, t.qty)}
            onCancel={(t) => void cancel(t.id)}
            working={working}
          />
        </>
      )}
    </div>
  );
}

// ─── Section ────────────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  count: number;
  tone: 'amber' | 'blue';
  tasks: TaskRow[];
  actionLabel: string;
  onAction: (t: TaskRow) => void;
  onCancel: (t: TaskRow) => void;
  working: number | null;
}

function Section({ title, count, tone, tasks, actionLabel, onAction, onCancel, working }: SectionProps) {
  const dotTone = tone === 'amber' ? 'bg-amber-500' : 'bg-blue-500';
  return (
    <section className="mb-6 rounded-3xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
        <span className={`h-2 w-2 rounded-full ${dotTone}`} aria-hidden="true" />
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">
          {count}
        </span>
      </header>
      {tasks.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-slate-500">No tasks.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {tasks.map((t) => (
            <li key={t.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold text-slate-900">{t.sku}</span>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${STATUS_TONE[t.status]}`}
                  >
                    {t.status.replace('_', ' ')}
                  </span>
                  <span className="text-xs text-slate-500">
                    {new Date(t.detectedAt).toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700">
                  <span>
                    <span className="text-slate-400">From bin</span>{' '}
                    <span className="font-mono font-semibold">{t.fromBinId ?? '—'}</span>
                  </span>
                  <span aria-hidden="true" className="text-slate-300">→</span>
                  <span>
                    <span className="text-slate-400">To bin</span>{' '}
                    <span className="font-mono font-semibold">{t.toBinId}</span>
                  </span>
                  <span>
                    <span className="text-slate-400">Qty</span>{' '}
                    <span className="font-bold tabular-nums">{t.qty}</span>
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={working === t.id}
                  onClick={() => onAction(t)}
                  className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm active:bg-slate-800 disabled:opacity-50"
                >
                  {working === t.id ? 'Working…' : actionLabel}
                </button>
                <button
                  type="button"
                  disabled={working === t.id}
                  onClick={() => onCancel(t)}
                  className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <div className="grid place-items-center rounded-3xl border border-emerald-200 bg-emerald-50 px-6 py-12 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-600 text-white">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <p className="mt-3 text-base font-bold text-emerald-900">All pick faces stocked</p>
      <p className="mt-1 text-sm text-emerald-800/80">
        The detector will create new tasks when forward bins drop below their minimum.
      </p>
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
      <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600 align-middle" />
      <span className="ml-2 align-middle">Loading tasks…</span>
    </div>
  );
}
