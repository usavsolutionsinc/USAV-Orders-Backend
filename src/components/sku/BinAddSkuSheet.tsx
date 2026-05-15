'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Search, X } from '@/components/Icons';
import { usePersistedStaffId } from '@/hooks/usePersistedStaffId';
import { errorFeedback, successFeedback } from '@/lib/feedback/confirm';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface SkuSearchRow {
  id: number;
  sku: string | null;
  stock: number | null;
  product_title: string | null;
  /** Source tag: 'stock' = already in sku_stock; 'ecwid' = only in Ecwid catalog. */
  source: 'stock' | 'ecwid';
}

interface BinAddSkuSheetProps {
  open: boolean;
  onClose: () => void;
  binBarcode: string;
  /** React-query key to invalidate after a successful PUT. */
  invalidateKey: readonly unknown[];
}

// ─── Hook: debounced /api/sku-stock search ─────────────────────────────────

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Add a new SKU to the current bin. Ecwid-only search via /api/sku-stock,
 * which joins the Ecwid display_name so the result shows the Ecwid title and
 * SKU as a unit. (Zoho SKU field is not surfaced — still in development.)
 */
export function BinAddSkuSheet({
  open,
  onClose,
  binBarcode,
  invalidateKey,
}: BinAddSkuSheetProps) {
  const [staffId] = usePersistedStaffId();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 250);
  const [rows, setRows] = useState<SkuSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<SkuSearchRow | null>(null);
  const [qtyDraft, setQtyDraft] = useState('1');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset when the sheet opens/closes.
  useEffect(() => {
    if (open) {
      setQuery('');
      setRows([]);
      setError(null);
      setSelected(null);
      setQtyDraft('1');
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  // Federated search: in-stock SKUs + Ecwid catalog (title or SKU match).
  // Dedup by uppercase SKU — when a product is in both lists we keep the
  // in-stock row because it carries the live total qty.
  useEffect(() => {
    if (!open) return;
    const q = debounced.trim();
    if (!q) {
      setRows([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`/api/sku-stock?q=${encodeURIComponent(q)}&limit=20`, {
        cache: 'no-store',
      })
        .then((res) => res.json())
        .catch(() => null),
      fetch(
        `/api/sku-catalog/search?q=${encodeURIComponent(q)}&searchField=title&limit=20`,
        { cache: 'no-store' },
      )
        .then((res) => res.json())
        .catch(() => null),
    ])
      .then(([stockData, ecwidData]) => {
        if (cancelled) return;
        const stockRows: SkuSearchRow[] = Array.isArray(stockData?.rows)
          ? (stockData.rows as Array<Partial<SkuSearchRow>>).map((r) => ({
              id: Number(r.id ?? 0),
              sku: r.sku ?? null,
              stock: r.stock ?? 0,
              product_title: r.product_title ?? null,
              source: 'stock' as const,
            }))
          : [];
        const ecwidRows: SkuSearchRow[] = Array.isArray(ecwidData?.items)
          ? (ecwidData.items as Array<Partial<SkuSearchRow>>).map((r) => ({
              id: -Number(r.id ?? Math.random()),
              sku: r.sku ?? null,
              stock: null,
              product_title: r.product_title ?? null,
              source: 'ecwid' as const,
            }))
          : [];

        const seen = new Set<string>();
        const merged: SkuSearchRow[] = [];
        for (const r of stockRows) {
          const key = (r.sku || '').trim().toUpperCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          merged.push(r);
        }
        for (const r of ecwidRows) {
          const key = (r.sku || '').trim().toUpperCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          merged.push(r);
        }
        setRows(merged.slice(0, 30));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Search failed');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, open]);

  const applyPut = useCallback(async () => {
    if (!selected?.sku || busy) return;
    const qty = Number(qtyDraft);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Quantity must be > 0');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const idempotencyKey = randomId();
      const res = await fetch(
        `/api/locations/${encodeURIComponent(binBarcode)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({
            action: 'put',
            sku: selected.sku,
            qty: Math.floor(qty),
            staffId,
            reason: 'BIN_ADD',
            clientEventId: idempotencyKey,
          }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      await queryClient.invalidateQueries({ queryKey: invalidateKey });
      successFeedback();
      onClose();
    } catch (err) {
      errorFeedback();
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setBusy(false);
    }
  }, [binBarcode, busy, invalidateKey, onClose, qtyDraft, queryClient, selected, staffId]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add product to bin"
      className="fixed inset-0 z-[100] flex flex-col bg-white"
    >
      <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-3">
        <button
          type="button"
          onClick={() => (selected ? setSelected(null) : onClose())}
          aria-label="Back"
          className="h-10 w-10 rounded-md border border-slate-300 bg-white text-sm font-bold text-slate-700 active:bg-slate-50"
        >
          {selected ? '←' : <X className="mx-auto h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            Add to bin
          </p>
          <p className="truncate font-mono text-[13px] font-black text-slate-900">
            {binBarcode}
          </p>
        </div>
      </header>

      {!selected ? (
        <>
          <div className="border-b border-slate-200 px-3 py-2">
            <div className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 focus-within:border-blue-500">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                inputMode="search"
                autoComplete="off"
                placeholder="Search Ecwid SKU or product title"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-900 outline-none placeholder:font-medium placeholder:text-slate-400"
              />
              {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            </div>
          </div>

          <main className="flex-1 overflow-auto px-3 py-3">
            {error && (
              <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
                {error}
              </div>
            )}
            {!loading && debounced.trim() && rows.length === 0 && !error && (
              <p className="px-2 py-8 text-center text-sm font-semibold text-slate-500">
                No matches for &ldquo;{debounced.trim()}&rdquo;.
              </p>
            )}
            {!debounced.trim() && (
              <p className="px-2 py-8 text-center text-[11px] font-bold uppercase tracking-widest text-slate-400">
                Type a few characters to search
              </p>
            )}
            <ul className="space-y-2">
              {rows.map((row) => {
                const sku = (row.sku || '').trim();
                if (!sku) return null;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setSelected({
                          ...row,
                          sku,
                        })
                      }
                      className="flex w-full items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm active:bg-slate-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-black text-slate-900">
                          {sku}
                        </p>
                        {row.product_title && (
                          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500">
                            {row.product_title}
                          </p>
                        )}
                      </div>
                      {row.source === 'stock' ? (
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                          {row.stock ?? 0} on hand
                        </span>
                      ) : (
                        <span
                          className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700"
                          title="Not yet in stock — will create the entry on first put"
                        >
                          Ecwid only
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </main>
        </>
      ) : (
        <main className="flex-1 overflow-auto px-4 py-6">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="font-mono text-base font-black text-slate-900">
              {selected.sku}
            </p>
            {selected.product_title && (
              <p className="mt-1 text-[11px] leading-snug text-slate-500">
                {selected.product_title}
              </p>
            )}
            <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Currently {selected.stock ?? 0} total on hand
            </p>
          </div>

          <label className="mt-6 block">
            <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
              Add to this bin
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={qtyDraft}
              onChange={(e) => setQtyDraft(e.target.value)}
              autoFocus
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-center font-mono text-2xl font-black text-slate-900 focus:border-blue-500 focus:outline-none"
            />
          </label>

          {error && (
            <p className="mt-3 text-sm font-bold text-rose-600">{error}</p>
          )}

          <div className="mt-6 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSelected(null)}
              disabled={busy}
              className="rounded-md border border-slate-300 bg-white px-3 py-3 text-sm font-bold text-slate-700 active:bg-slate-50 disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              disabled={busy || !qtyDraft.trim()}
              onClick={applyPut}
              className="rounded-md bg-blue-600 px-3 py-3 text-sm font-bold text-white active:bg-blue-700 disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : (
                'Add'
              )}
            </button>
          </div>
        </main>
      )}
    </div>
  );
}
