'use client';

/**
 * StudioRecoveryPanel — the unpark/recovery surface (engine Phase 1.0).
 *
 * Lists the workflow items the engine parked as `blocked` (a node is awaiting a
 * human/event) or `error` (a node threw or its type vanished) for the active
 * definition, with a one-click Recover that resets the position to `active` so
 * the next tap advances it. Self-contained: fetches GET /api/studio/items/stuck
 * and POSTs /api/studio/items/[id]/recover. Recovery is gated server-side by
 * `studio.recover`; a caller without it gets a 403 surfaced inline.
 *
 * Rendered in the Inspector's no-node (workflow summary) view — the graph-level
 * place "items needing attention across the whole flow" belongs. The richer
 * triage view (filters, bulk recover) is the Studio §2 roadmap item.
 */

import { useCallback, useEffect, useState } from 'react';

interface StuckItem {
  serialUnitId: number;
  status: 'blocked' | 'error';
  nodeId: string;
  nodeType: string | null;
  enteredNodeAt: string | null;
  lastError: string | null;
  serialNumber: string | null;
  sku: string | null;
  currentStatus: string | null;
}

export function StudioRecoveryPanel({ definitionId }: { definitionId: number }) {
  const [items, setItems] = useState<StuckItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recovering, setRecovering] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/studio/items/stuck?v=${definitionId}`, { cache: 'no-store' });
      const json = (await res.json()) as { ok: boolean; items?: StuckItem[]; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setItems(json.items ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load stuck items');
      setItems([]);
    }
  }, [definitionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const recover = useCallback(
    async (serialUnitId: number) => {
      setRecovering(serialUnitId);
      setError(null);
      try {
        const res = await fetch(`/api/studio/items/${serialUnitId}/recover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: 'Recovered from Operations Studio' }),
        });
        const json = (await res.json()) as { ok: boolean; error?: string };
        if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
        // Optimistically drop the row; the engine's db-event will reconcile counts.
        setItems((prev) => (prev ? prev.filter((i) => i.serialUnitId !== serialUnitId) : prev));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'recovery failed');
      } finally {
        setRecovering(null);
      }
    },
    [],
  );

  // Nothing parked → stay quiet (no empty-state noise) unless a load error.
  if (items !== null && items.length === 0 && !error) return null;

  return (
    <section>
      <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        Stuck items{items ? ` · ${items.length}` : ''}
      </h3>

      {error && <p className="mb-1.5 text-[11px] font-semibold text-rose-600">{error}</p>}
      {items === null && <p className="text-xs text-slate-400">Checking…</p>}

      <ul className="space-y-1.5">
        {(items ?? []).map((it) => (
          <li
            key={it.serialUnitId}
            className="rounded-md border border-slate-100 bg-slate-50/60 px-2 py-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-[11px] font-semibold text-slate-700">
                {it.serialNumber || `#${it.serialUnitId}`}
              </span>
              <span
                className={[
                  'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                  it.status === 'error'
                    ? 'bg-rose-50 text-rose-600'
                    : 'bg-amber-50 text-amber-700',
                ].join(' ')}
              >
                {it.status}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[10px] text-slate-400">
              {it.sku ? `${it.sku} · ` : ''}
              {it.currentStatus ?? '—'}
              {it.nodeType ? ` · at ${it.nodeType}` : ''}
            </p>
            {it.lastError && (
              <p className="mt-0.5 truncate text-[10px] text-rose-400" title={it.lastError}>
                ↳ {it.lastError}
              </p>
            )}
            <button
              type="button"
              onClick={() => void recover(it.serialUnitId)}
              disabled={recovering === it.serialUnitId}
              className="mt-1 w-full rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
            >
              {recovering === it.serialUnitId ? 'Recovering…' : 'Recover (unpark)'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
