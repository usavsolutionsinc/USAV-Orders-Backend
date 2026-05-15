'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from '@/components/Icons';
import { usePersistedStaffId } from '@/hooks/usePersistedStaffId';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BinSkuEditorRowData {
  id: number;
  sku: string;
  qty: number;
  minQty: number | null;
  maxQty: number | null;
  lastCounted: string | null;
  productTitle: string | null;
}

interface BinSkuEditorRowProps {
  /** Bin barcode — used for PATCH /api/locations/{barcode}. */
  binBarcode: string;
  row: BinSkuEditorRowData;
  /** React-query key to invalidate after a successful write. */
  invalidateKey: readonly unknown[];
  /** Open the SKU side panel when the SKU is tapped (read-only). */
  onOpenSku?: (sku: string) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'recently';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * One editable bin-contents row. Closed: SKU + product title + qty.
 * Open: qty stepper, min/max edit, mark counted, soft-remove (set qty=0).
 *
 * Every write goes through PATCH /api/locations/{barcode} which already
 * updates bin_contents, sku_stock_ledger, and (via trigger) sku_stock.
 * After a successful write the parent's react-query bin-contents query is
 * invalidated.
 */
export function BinSkuEditorRow({
  binBarcode,
  row,
  invalidateKey,
  onOpenSku,
}: BinSkuEditorRowProps) {
  const [staffId] = usePersistedStaffId();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'put' | 'take' | 'set' | 'count' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Edit-state mirrors of the server values; reset when row changes.
  const [qtyDraft, setQtyDraft] = useState<string>(String(row.qty ?? 0));
  const [minDraft, setMinDraft] = useState<string>(
    row.minQty != null ? String(row.minQty) : '',
  );
  const [maxDraft, setMaxDraft] = useState<string>(
    row.maxQty != null ? String(row.maxQty) : '',
  );

  useEffect(() => {
    setQtyDraft(String(row.qty ?? 0));
    setMinDraft(row.minQty != null ? String(row.minQty) : '');
    setMaxDraft(row.maxQty != null ? String(row.maxQty) : '');
  }, [row.qty, row.minQty, row.maxQty]);

  const patchBin = useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      try {
        const res = await fetch(
          `/api/locations/${encodeURIComponent(binBarcode)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sku: row.sku, staffId, ...body }),
          },
        );
        const data = await res.json().catch(() => null);
        if (!res.ok || data?.success === false) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Update failed');
        return false;
      }
    },
    [binBarcode, row.sku, staffId],
  );

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: invalidateKey }),
    [queryClient, invalidateKey],
  );

  const adjust = useCallback(
    async (delta: number) => {
      if (busy || delta === 0) return;
      setBusy(delta > 0 ? 'put' : 'take');
      setError(null);
      const ok = await patchBin({
        action: delta > 0 ? 'put' : 'take',
        qty: Math.abs(delta),
      });
      setBusy(null);
      if (ok) await invalidate();
    },
    [busy, invalidate, patchBin],
  );

  const applyAbsolute = useCallback(async () => {
    if (busy) return;
    const qty = Number(qtyDraft);
    if (!Number.isFinite(qty) || qty < 0) {
      setError('Quantity must be ≥ 0');
      return;
    }
    const minQty = minDraft.trim() === '' ? null : Number(minDraft);
    const maxQty = maxDraft.trim() === '' ? null : Number(maxDraft);
    if (minQty != null && !Number.isFinite(minQty)) {
      setError('Min must be a number');
      return;
    }
    if (maxQty != null && !Number.isFinite(maxQty)) {
      setError('Max must be a number');
      return;
    }
    setBusy('set');
    setError(null);
    const ok = await patchBin({
      action: 'set',
      qty: Math.floor(qty),
      minQty: minQty ?? undefined,
      maxQty: maxQty ?? undefined,
    });
    setBusy(null);
    if (ok) await invalidate();
  }, [busy, invalidate, maxDraft, minDraft, patchBin, qtyDraft]);

  const markCounted = useCallback(async () => {
    if (busy) return;
    setBusy('count');
    setError(null);
    const ok = await patchBin({ action: 'count' });
    setBusy(null);
    if (ok) await invalidate();
  }, [busy, invalidate, patchBin]);

  const remove = useCallback(async () => {
    if (busy) return;
    setBusy('remove');
    setError(null);
    const ok = await patchBin({ action: 'set', qty: 0 });
    setBusy(null);
    if (ok) await invalidate();
  }, [busy, invalidate, patchBin]);

  const capacityFill = row.maxQty && row.maxQty > 0 ? Math.min(1, row.qty / row.maxQty) : null;
  const lowStock = row.minQty != null && row.qty <= row.minQty;

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      {/* Closed row */}
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => onOpenSku?.(row.sku)}
          className="min-w-0 flex-1 text-left"
        >
          <p className="font-mono text-sm font-black text-slate-900">{row.sku}</p>
          {row.productTitle && (
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500">
              {row.productTitle}
            </p>
          )}
          <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Counted {formatAgo(row.lastCounted)} ago
            {row.minQty != null && row.maxQty != null
              ? ` · ${row.minQty}–${row.maxQty}`
              : ''}
            {lowStock ? ' · LOW' : ''}
          </p>
          {capacityFill != null && (
            <div className="mt-2 h-1 w-full overflow-hidden rounded bg-slate-100">
              <div
                className={`h-full ${lowStock ? 'bg-rose-500' : 'bg-emerald-500'}`}
                style={{ width: `${capacityFill * 100}%` }}
              />
            </div>
          )}
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={busy != null || row.qty <= 0}
            onClick={() => adjust(-1)}
            aria-label="Take one"
            className="h-10 w-10 rounded-md bg-slate-100 text-lg font-black text-slate-700 active:bg-slate-200 disabled:opacity-40"
          >
            −
          </button>
          <span className="min-w-[2rem] text-center text-lg font-black tabular-nums text-slate-900">
            {row.qty}
          </span>
          <button
            type="button"
            disabled={busy != null}
            onClick={() => adjust(1)}
            aria-label="Put one"
            className="h-10 w-10 rounded-md bg-blue-600 text-lg font-black text-white active:bg-blue-700 disabled:opacity-40"
          >
            +
          </button>
        </div>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'Collapse editor' : 'Expand editor'}
          className="ml-1 h-10 w-10 shrink-0 rounded-md border border-slate-300 bg-white text-sm font-bold text-slate-700 active:bg-slate-50"
        >
          {open ? '×' : '⋯'}
        </button>
      </div>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-3">
          {/* Absolute qty + min/max */}
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                Qty
              </span>
              <input
                type="number"
                inputMode="numeric"
                value={qtyDraft}
                onChange={(e) => setQtyDraft(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-center font-mono text-base font-bold text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                Min
              </span>
              <input
                type="number"
                inputMode="numeric"
                placeholder="—"
                value={minDraft}
                onChange={(e) => setMinDraft(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-center font-mono text-base font-bold text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                Max
              </span>
              <input
                type="number"
                inputMode="numeric"
                placeholder="—"
                value={maxDraft}
                onChange={(e) => setMaxDraft(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-2 text-center font-mono text-base font-bold text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy != null}
              onClick={applyAbsolute}
              className="flex-1 min-w-[6rem] rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white active:bg-slate-800 disabled:opacity-40"
            >
              {busy === 'set' ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : (
                'Apply'
              )}
            </button>
            <button
              type="button"
              disabled={busy != null}
              onClick={markCounted}
              className="flex-1 min-w-[6rem] rounded-md border border-emerald-600 bg-white px-3 py-2 text-xs font-bold text-emerald-700 active:bg-emerald-50 disabled:opacity-40"
            >
              {busy === 'count' ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : (
                'Mark counted'
              )}
            </button>
            <button
              type="button"
              disabled={busy != null || row.qty === 0}
              onClick={remove}
              className="flex-1 min-w-[6rem] rounded-md border border-rose-300 bg-white px-3 py-2 text-xs font-bold text-rose-700 active:bg-rose-50 disabled:opacity-40"
            >
              {busy === 'remove' ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : (
                'Remove'
              )}
            </button>
          </div>

          {error && (
            <p className="text-[11px] font-bold text-rose-600">{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
