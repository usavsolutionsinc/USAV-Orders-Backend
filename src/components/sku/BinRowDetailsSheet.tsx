'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, X } from '@/components/Icons';
import { usePersistedStaffId } from '@/hooks/usePersistedStaffId';
import { errorFeedback, successFeedback } from '@/lib/feedback/confirm';
import { useStaffRole } from '@/hooks/useStaffRole';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BinRowDetailsData {
  sku: string;
  qty: number;
  productTitle: string | null;
  /** display_name_override from sku_stock — empty string when unset. */
  displayNameOverride: string | null;
  minQty: number | null;
  maxQty: number | null;
  /** Version token from the bin_contents row — used for optimistic concurrency. */
  updatedAt?: string | null;
}

interface BinRowDetailsSheetProps {
  open: boolean;
  onClose: () => void;
  binBarcode: string;
  row: BinRowDetailsData | null;
  /** Invalidate the parent bin-contents query after any write. */
  invalidateKey: readonly unknown[];
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Reached from the stock numpad's "⋯ details" button. Lets the receiver:
 *  • rename the product title (writes sku_stock.display_name_override)
 *  • change the SKU (atomic transfer via /api/locations/[barcode]/swap)
 *  • adjust min/max thresholds
 *
 * The override is non-destructive — clearing it falls back to Ecwid/catalog.
 */
export function BinRowDetailsSheet({
  open,
  onClose,
  binBarcode,
  row,
  invalidateKey,
}: BinRowDetailsSheetProps) {
  const [staffId] = usePersistedStaffId();
  const { isAdmin, role } = useStaffRole();
  const queryClient = useQueryClient();

  const [titleDraft, setTitleDraft] = useState('');
  const [transferToDraft, setTransferToDraft] = useState('');
  const [transferQtyDraft, setTransferQtyDraft] = useState('');
  const [skuDraft, setSkuDraft] = useState('');
  const [minDraft, setMinDraft] = useState('');
  const [maxDraft, setMaxDraft] = useState('');
  const [busy, setBusy] = useState<'rename' | 'swap' | 'limits' | 'transfer' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !row) return;
    setTitleDraft((row.displayNameOverride || '').trim());
    setSkuDraft(row.sku);
    setMinDraft(row.minQty != null ? String(row.minQty) : '');
    setMaxDraft(row.maxQty != null ? String(row.maxQty) : '');
    setTransferToDraft('');
    setTransferQtyDraft('');
    setError(null);
    setInfo(null);
  }, [open, row]);

  useEffect(() => {
    if (!info) return;
    const t = setTimeout(() => setInfo(null), 1800);
    return () => clearTimeout(t);
  }, [info]);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: invalidateKey }),
    [invalidateKey, queryClient],
  );

  const saveTitle = useCallback(async () => {
    if (!row || busy) return;
    const next = titleDraft.trim();
    setBusy('rename');
    setError(null);
    try {
      const idempotencyKey = randomId();
      const res = await fetch(
        `/api/sku-stock/${encodeURIComponent(row.sku)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify(
            next
              ? { action: 'rename', productTitle: next, staffId, clientEventId: idempotencyKey }
              : { action: 'rename', clearOverride: true, staffId, clientEventId: idempotencyKey },
          ),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      await invalidate();
      successFeedback();
      setInfo(next ? 'Title saved' : 'Title cleared');
    } catch (err) {
      errorFeedback();
      setError(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setBusy(null);
    }
  }, [busy, invalidate, row, staffId, titleDraft]);

  const swapSku = useCallback(async () => {
    if (!row || busy) return;
    const next = skuDraft.trim();
    if (!next) {
      setError('Enter a SKU');
      return;
    }
    if (next.toUpperCase() === row.sku.toUpperCase()) {
      setError('SKU is unchanged');
      return;
    }
    setBusy('swap');
    setError(null);
    try {
      const idempotencyKey = randomId();
      const res = await fetch(
        `/api/locations/${encodeURIComponent(binBarcode)}/swap`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({
            oldSku: row.sku,
            newSku: next,
            staffId,
            clientEventId: idempotencyKey,
          }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      await invalidate();
      successFeedback();
      setInfo(`Moved ${data.qty_transferred ?? row.qty} → ${next}`);
      onClose();
    } catch (err) {
      errorFeedback();
      setError(err instanceof Error ? err.message : 'Swap failed');
    } finally {
      setBusy(null);
    }
  }, [binBarcode, busy, invalidate, onClose, row, skuDraft, staffId]);

  const transfer = useCallback(async () => {
    if (!row || busy) return;
    const toBin = transferToDraft.trim();
    const qtyNum = Number(transferQtyDraft);
    if (!toBin) {
      setError('Scan or type the destination bin');
      return;
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError('Quantity must be > 0');
      return;
    }
    if (qtyNum > row.qty) {
      setError(`Only ${row.qty} on hand`);
      return;
    }
    setBusy('transfer');
    setError(null);
    try {
      const idempotencyKey = randomId();
      const res = await fetch('/api/transfers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          fromBinBarcode: binBarcode,
          toBinBarcode: toBin,
          sku: row.sku,
          qty: Math.floor(qtyNum),
          staffId,
          clientEventId: idempotencyKey,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      await invalidate();
      successFeedback();
      setInfo(`Moved ${data.qty} → ${toBin}`);
      setTransferToDraft('');
      setTransferQtyDraft('');
      onClose();
    } catch (err) {
      errorFeedback();
      setError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setBusy(null);
    }
  }, [binBarcode, busy, invalidate, onClose, row, staffId, transferQtyDraft, transferToDraft]);

  const saveLimits = useCallback(async () => {
    if (!row || busy) return;
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
    setBusy('limits');
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
            action: 'set',
            sku: row.sku,
            qty: row.qty,
            minQty: minQty ?? undefined,
            maxQty: maxQty ?? undefined,
            staffId,
            clientEventId: idempotencyKey,
            // Optimistic concurrency: server rejects if the row moved.
            expectedUpdatedAt: row.updatedAt ?? undefined,
          }),
        },
      );
      const data = await res.json().catch(() => null);
      if (res.status === 409 && data?.error === 'STALE') {
        errorFeedback();
        setError(
          typeof data?.message === 'string'
            ? data.message
            : 'Another device updated this row. Refresh and try again.',
        );
        await invalidate();
        return;
      }
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      await invalidate();
      successFeedback();
      setInfo('Limits saved');
    } catch (err) {
      errorFeedback();
      setError(err instanceof Error ? err.message : 'Limits update failed');
    } finally {
      setBusy(null);
    }
  }, [binBarcode, busy, invalidate, maxDraft, minDraft, row, staffId]);

  if (!open || !row) return null;

  const overrideEffective =
    titleDraft.trim().length > 0 && titleDraft.trim() !== (row.productTitle || '');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit row details"
      className="fixed inset-0 z-[140] flex flex-col bg-slate-50"
    >
      <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back"
          className="h-11 w-11 rounded-md border border-slate-300 bg-white text-sm font-bold text-slate-700 active:bg-slate-50"
        >
          ←
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
            Row details
          </p>
          <p className="truncate font-mono text-[13px] font-black text-slate-900">
            {row.sku}
          </p>
        </div>
        <span className="h-11 w-11" />
      </header>

      <main className="flex-1 overflow-auto px-4 py-4 space-y-5 pb-32">
        {!isAdmin && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] font-bold text-amber-800">
            Product title and SKU swap require <span className="uppercase">admin</span> role.
            You&apos;re signed in as <span className="uppercase">{role}</span>. Limits + counts are still editable.
          </div>
        )}

        {/* Title override */}
        <section
          aria-disabled={!isAdmin}
          className={`rounded-lg border border-slate-200 bg-white p-3 shadow-sm space-y-2 ${
            isAdmin ? '' : 'opacity-50 pointer-events-none'
          }`}
        >
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            Product title
          </p>
          {row.productTitle && (
            <p className="text-[10px] leading-snug text-slate-500">
              <span className="font-bold">Catalog:</span>{' '}
              <span className="font-mono">{row.productTitle}</span>
            </p>
          )}
          <textarea
            rows={2}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            placeholder="Short label (overrides catalog/Ecwid)"
            className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm font-bold text-slate-900 focus:border-blue-500 focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveTitle}
              disabled={busy !== null}
              className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-xs font-bold text-white active:bg-blue-700 disabled:opacity-40"
            >
              {busy === 'rename' ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : titleDraft.trim() === '' ? (
                'Clear override'
              ) : overrideEffective ? (
                'Save title'
              ) : (
                'Save title'
              )}
            </button>
          </div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Stored in sku_stock.display_name_override · wins over Ecwid
          </p>
        </section>

        {/* SKU swap */}
        <section
          aria-disabled={!isAdmin}
          className={`rounded-lg border border-slate-200 bg-white p-3 shadow-sm space-y-2 ${
            isAdmin ? '' : 'opacity-50 pointer-events-none'
          }`}
        >
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            Change SKU
          </p>
          <p className="text-[10px] leading-snug text-slate-500">
            Move{' '}
            <span className="font-mono font-bold">{row.qty}</span> from{' '}
            <span className="font-mono">{row.sku}</span> to the SKU below.
          </p>
          <input
            type="text"
            autoCapitalize="characters"
            autoComplete="off"
            value={skuDraft}
            onChange={(e) => setSkuDraft(e.target.value)}
            placeholder="New SKU"
            className="w-full rounded-md border border-slate-300 px-3 py-3 text-center font-mono text-base font-black text-slate-900 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={swapSku}
            disabled={busy !== null || !skuDraft.trim()}
            className="w-full rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white active:bg-slate-800 disabled:opacity-40"
          >
            {busy === 'swap' ? (
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            ) : (
              `Swap → ${skuDraft.trim() || '…'}`
            )}
          </button>
        </section>

        {/* Transfer to another bin */}
        <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm space-y-2">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            Move to another bin
          </p>
          <p className="text-[10px] leading-snug text-slate-500">
            Scan or type the destination bin and how many to move.
          </p>
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <input
              type="text"
              autoCapitalize="characters"
              autoComplete="off"
              value={transferToDraft}
              onChange={(e) => setTransferToDraft(e.target.value)}
              placeholder="To bin"
              className="rounded-md border border-slate-300 px-3 py-2.5 text-center font-mono text-sm font-black text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={row.qty}
              value={transferQtyDraft}
              onChange={(e) => setTransferQtyDraft(e.target.value)}
              placeholder={`≤ ${row.qty}`}
              className="rounded-md border border-slate-300 px-2 py-2.5 text-center font-mono text-sm font-black text-slate-900 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={transfer}
            disabled={
              busy !== null || !transferToDraft.trim() || !transferQtyDraft.trim()
            }
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-xs font-bold text-white active:bg-blue-700 disabled:opacity-40"
          >
            {busy === 'transfer' ? (
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            ) : (
              `Move ${transferQtyDraft || '…'} → ${transferToDraft.trim() || '…'}`
            )}
          </button>
        </section>

        {/* Min / max */}
        <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm space-y-2">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            Min / max
          </p>
          <div className="grid grid-cols-2 gap-2">
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
          <button
            type="button"
            onClick={saveLimits}
            disabled={busy !== null}
            className="w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-xs font-bold text-slate-700 active:bg-slate-50 disabled:opacity-40"
          >
            {busy === 'limits' ? (
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            ) : (
              'Save limits'
            )}
          </button>
        </section>

        {error && (
          <p className="text-center text-sm font-bold text-rose-600">{error}</p>
        )}
        {info && !error && (
          <p className="text-center text-sm font-bold text-emerald-600">{info}</p>
        )}
      </main>
    </div>
  );
}
