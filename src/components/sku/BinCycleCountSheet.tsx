'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from '@/components/Icons';
import { usePersistedStaffId } from '@/hooks/usePersistedStaffId';
import { errorFeedback, successFeedback } from '@/lib/feedback/confirm';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

interface CountLine {
  id: number;
  sku: string;
  expected_qty: number;
  counted_qty: number | null;
  status: string;
  product_title: string | null;
}

interface BinCycleCountSheetProps {
  open: boolean;
  onClose: () => void;
  /** locations.id used to filter campaign lines. */
  binId: number;
  campaignId: number;
  campaignName: string;
  /** React-query key to invalidate on submit so the bin contents refresh. */
  invalidateKey: readonly unknown[];
}

/**
 * Inline cycle-count sheet — lists every cycle_count_lines row for this bin
 * in the active campaign and lets the receiver type a counted qty per row.
 * Submits each row independently so partial counts don't get lost on
 * connection drops.
 */
export function BinCycleCountSheet({
  open,
  onClose,
  binId,
  campaignId,
  campaignName,
  invalidateKey,
}: BinCycleCountSheetProps) {
  const [staffId] = usePersistedStaffId();
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<CountLine[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyLineId, setBusyLineId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/cycle-counts/campaigns/${campaignId}?bin_id=${binId}`,
        { cache: 'no-store' },
      );
      const data = await res.json();
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setLines(Array.isArray(data?.lines) ? data.lines : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lines');
    } finally {
      setLoading(false);
    }
  }, [binId, campaignId]);

  useEffect(() => {
    if (!open) return;
    setDrafts({});
    setFlash(null);
    setError(null);
    load();
  }, [open, load]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  const submit = useCallback(
    async (line: CountLine) => {
      if (busyLineId != null) return;
      const raw = drafts[line.id];
      const qty = Number(raw);
      if (!Number.isFinite(qty) || qty < 0) {
        setError('Enter a count');
        errorFeedback();
        return;
      }
      setBusyLineId(line.id);
      setError(null);
      try {
        const idempotencyKey = randomId();
        const res = await fetch(`/api/cycle-counts/lines/${line.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({
            action: 'submit',
            countedQty: Math.floor(qty),
            staffId,
            clientEventId: idempotencyKey,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || data?.success === false) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        successFeedback();
        const needsReview = data?.needs_review === true;
        setFlash(
          needsReview
            ? `Over tolerance · queued for review`
            : `✓ counted ${qty}`,
        );
        await load();
        await queryClient.invalidateQueries({ queryKey: invalidateKey });
      } catch (err) {
        errorFeedback();
        setError(err instanceof Error ? err.message : 'Submit failed');
      } finally {
        setBusyLineId(null);
      }
    },
    [busyLineId, drafts, invalidateKey, load, queryClient, staffId],
  );

  if (!open) return null;

  const pendingCount = lines.filter((l) => l.status === 'pending').length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cycle count"
      className="fixed inset-0 z-[130] flex flex-col bg-slate-50"
    >
      <header className="border-b border-slate-200 bg-white px-4 py-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back"
          className="h-11 w-11 rounded-md border border-slate-300 bg-white text-sm font-bold text-slate-700 active:bg-slate-50"
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
            Cycle count
          </p>
          <h1 className="truncate text-sm font-black text-slate-900">{campaignName}</h1>
          <p className="text-[11px] font-bold text-slate-500">
            {pendingCount} of {lines.length} pending
          </p>
        </div>
      </header>

      {flash && (
        <div className="bg-emerald-50 px-4 py-1.5 text-center text-[11px] font-black uppercase tracking-widest text-emerald-700">
          {flash}
        </div>
      )}
      {error && (
        <div className="bg-rose-50 px-4 py-1.5 text-center text-[11px] font-black uppercase tracking-widest text-rose-700">
          {error}
        </div>
      )}

      <main className="flex-1 overflow-auto px-3 py-3 pb-24 space-y-2">
        {loading && (
          <p className="text-center text-sm font-semibold text-slate-500 py-6">Loading…</p>
        )}
        {!loading && lines.length === 0 && (
          <p className="text-center text-sm font-semibold text-slate-500 py-6">
            No lines for this bin in this campaign.
          </p>
        )}
        {lines.map((line) => {
          const done = line.status !== 'pending' && line.status !== 'counted';
          return (
            <div
              key={line.id}
              className={`rounded-lg border bg-white p-3 shadow-sm ${
                done ? 'border-emerald-200 opacity-90' : 'border-slate-200'
              }`}
            >
              <p className="font-mono text-sm font-black text-slate-900">{line.sku}</p>
              {line.product_title && (
                <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500">
                  {line.product_title}
                </p>
              )}
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Expected {line.expected_qty} · {line.status}
              </p>

              {!done ? (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="Counted"
                    value={drafts[line.id] ?? ''}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [line.id]: e.target.value }))
                    }
                    className="flex-1 rounded-md border border-slate-300 px-3 py-2.5 text-center font-mono text-base font-bold text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={busyLineId != null}
                    onClick={() => submit(line)}
                    className="rounded-md bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white active:bg-emerald-700 disabled:opacity-40"
                  >
                    {busyLineId === line.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Submit'
                    )}
                  </button>
                </div>
              ) : (
                <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                  <Check className="h-3 w-3" />
                  Counted {line.counted_qty ?? '—'}
                </p>
              )}
            </div>
          );
        })}
      </main>
    </div>
  );
}
