'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X } from '@/components/Icons';
import { usePersistedStaffId } from '@/hooks/usePersistedStaffId';
import { errorFeedback, successFeedback } from '@/lib/feedback/confirm';
import { ReasonCodePicker, type ReasonCode } from '@/components/sku/ReasonCodePicker';
import { queueOrFetch } from '@/lib/offline/write-queue';
import {
  MobilePackerSpamCamera,
  type CapturedShot,
} from '@/components/mobile/station/MobilePackerSpamCamera';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BinNumpadRow {
  sku: string;
  qty: number;
  productTitle: string | null;
  /** Optional override seen on the row (so the title displays consistently). */
  displayNameOverride?: string | null;
}

interface BinStockNumpadSheetProps {
  open: boolean;
  onClose: () => void;
  binBarcode: string;
  row: BinNumpadRow | null;
  /** React-query key to invalidate after a successful write. */
  invalidateKey: readonly unknown[];
  /** Open the secondary details screen (rename / change SKU). */
  onOpenDetails?: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type Mode = 'minus' | 'plus';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read photo blob'));
    reader.readAsDataURL(blob);
  });
}

const KEYS: ReadonlyArray<string | number> = [
  1, 2, 3,
  4, 5, 6,
  7, 8, 9,
  'clear', 0, 'back',
];

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Fullscreen stock editor reached by tapping a bin row. Default mode is
 * "minus" (the common case — receiver pulling stock to ship/test) so a
 * single number tap + Confirm is the fast path. Toggle to "plus" for puts.
 */
export function BinStockNumpadSheet({
  open,
  onClose,
  binBarcode,
  row,
  invalidateKey,
  onOpenDetails,
}: BinStockNumpadSheetProps) {
  const [staffId] = usePersistedStaffId();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('minus');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [reason, setReason] = useState<ReasonCode | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [pendingShots, setPendingShots] = useState<CapturedShot[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('minus');
    setDraft('');
    setError(null);
    setFlash(null);
    setReason(null);
    setNoteDraft('');
    setPendingShots([]);
    setCameraOpen(false);
  }, [open, row?.sku]);

  // Reset reason when the direction toggles — the picker will auto-pick the
  // canonical default for the new direction.
  useEffect(() => {
    setReason(null);
    setNoteDraft('');
  }, [mode]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  const numericDraft = useMemo(() => {
    if (!draft) return 0;
    const n = parseInt(draft, 10);
    return Number.isFinite(n) ? n : 0;
  }, [draft]);

  const projected = useMemo(() => {
    if (!row) return 0;
    const delta = mode === 'minus' ? -numericDraft : numericDraft;
    return Math.max(0, row.qty + delta);
  }, [mode, numericDraft, row]);

  const pressKey = useCallback((key: string | number) => {
    setError(null);
    if (key === 'clear') {
      setDraft('');
      return;
    }
    if (key === 'back') {
      setDraft((prev) => prev.slice(0, -1));
      return;
    }
    setDraft((prev) => {
      const next = `${prev}${key}`.replace(/^0+(?=\d)/, '');
      // Cap the draft so a typo can't apply a runaway number.
      return next.length > 5 ? prev : next;
    });
  }, []);

  const confirm = useCallback(async () => {
    if (!row || busy) return;
    if (numericDraft <= 0) {
      setError('Tap a number first');
      return;
    }
    if (reason?.requires_note && !noteDraft.trim()) {
      setError(`Reason "${reason.label}" needs a note`);
      errorFeedback();
      return;
    }
    if (reason?.requires_photo && pendingShots.length === 0) {
      setError(`Reason "${reason.label}" needs a photo`);
      errorFeedback();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const action = mode === 'minus' ? 'take' : 'put';
      // Fresh UUID per Confirm tap — the server replays the cached response
      // on retry so a flaky network can't double-apply this take/put. The
      // queueOrFetch wrapper persists the request if we're offline and
      // returns a synthetic 202 so the receiver's flow stays smooth.
      const idempotencyKey = randomId();
      const res = await queueOrFetch({
        url: `/api/locations/${encodeURIComponent(binBarcode)}`,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          action,
          sku: row.sku,
          qty: numericDraft,
          staffId,
          reason: reason?.code ?? (action === 'put' ? 'BIN_ADD' : 'BIN_PULL'),
          reasonCodeId: reason?.id ?? null,
          notes: noteDraft.trim() || null,
          clientEventId: idempotencyKey,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      await queryClient.invalidateQueries({ queryKey: invalidateKey });
      successFeedback();
      // 202 = queued for sync — keep the same delta math in the UI so the
      // receiver sees the change land even before the server confirms.
      const queued = data?.queued === true;
      const sign = mode === 'minus' ? '−' : '+';

      // Upload any pending photos sequentially. The endpoint links each
      // photo to the new sku_stock_ledger row via ledgerId so the timeline
      // can show them alongside the adjustment.
      if (pendingShots.length > 0) {
        const ledgerId = Number(data?.ledgerId);
        const binId = Number(data?.binId);
        for (const shot of pendingShots) {
          try {
            const base64 = await blobToBase64(shot.blob);
            await fetch('/api/inventory-photos', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                photoBase64: base64,
                ledgerId: Number.isFinite(ledgerId) && ledgerId > 0 ? ledgerId : undefined,
                binId: Number.isFinite(binId) && binId > 0 ? binId : undefined,
                sku: row.sku,
                staffId,
                photoType: reason?.code?.toLowerCase() || 'bin_adjustment',
              }),
            });
          } catch (err) {
            console.warn('photo upload failed (non-fatal)', err);
          }
        }
      }

      setFlash(
        queued
          ? `${sign}${numericDraft} queued (offline)`
          : `${sign}${numericDraft} confirmed${pendingShots.length > 0 ? ` · ${pendingShots.length} photo${pendingShots.length === 1 ? '' : 's'}` : ''}`,
      );
      setDraft('');
      setNoteDraft('');
      // Revoke object URLs to free memory; we're done with the previews.
      pendingShots.forEach((s) => {
        try {
          URL.revokeObjectURL(s.previewUrl);
        } catch {
          /* ignore */
        }
      });
      setPendingShots([]);
    } catch (err) {
      errorFeedback();
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }, [
    binBarcode,
    busy,
    invalidateKey,
    mode,
    noteDraft,
    numericDraft,
    pendingShots,
    queryClient,
    reason,
    row,
    staffId,
  ]);

  if (!open || !row) return null;

  const title =
    (row.displayNameOverride && row.displayNameOverride.trim()) ||
    (row.productTitle && row.productTitle.trim()) ||
    null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit stock"
      className="fixed inset-0 z-[120] flex flex-col bg-slate-50"
    >
      {/* ── Header ── */}
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
            Edit stock
          </p>
          <p className="truncate font-mono text-[13px] font-black text-slate-900">
            {row.sku}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenDetails}
          aria-label="Details"
          className="h-11 w-11 rounded-md border border-slate-300 bg-white text-sm font-bold text-slate-700 active:bg-slate-50"
        >
          ⋯
        </button>
      </header>

      {/* ── Body ── */}
      <main className="flex-1 overflow-auto px-4 py-5 space-y-5">
        {title && (
          <p className="text-center text-[12px] leading-snug font-bold text-slate-600">
            {title}
          </p>
        )}

        {/* Mode toggle */}
        <div className="mx-auto grid w-full max-w-sm grid-cols-2 overflow-hidden rounded-lg border border-slate-300 bg-white">
          <button
            type="button"
            onClick={() => setMode('minus')}
            aria-pressed={mode === 'minus'}
            className={`py-3 text-base font-black ${
              mode === 'minus'
                ? 'bg-rose-600 text-white'
                : 'bg-white text-slate-700'
            }`}
          >
            − TAKE
          </button>
          <button
            type="button"
            onClick={() => setMode('plus')}
            aria-pressed={mode === 'plus'}
            className={`py-3 text-base font-black ${
              mode === 'plus'
                ? 'bg-emerald-600 text-white'
                : 'bg-white text-slate-700'
            }`}
          >
            + PUT
          </button>
        </div>

        {/* Current vs projected */}
        <div className="mx-auto grid w-full max-w-sm grid-cols-3 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <div className="text-center">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
              On hand
            </p>
            <p className="mt-1 font-mono text-3xl font-black text-slate-900">
              {row.qty}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
              Change
            </p>
            <p
              className={`mt-1 font-mono text-3xl font-black ${
                mode === 'minus' ? 'text-rose-600' : 'text-emerald-600'
              }`}
            >
              {mode === 'minus' ? '−' : '+'}
              {numericDraft || 0}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
              After
            </p>
            <p className="mt-1 font-mono text-3xl font-black text-slate-900">
              {projected}
            </p>
          </div>
        </div>

        {/* Reason + optional note */}
        <div className="mx-auto w-full max-w-sm space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <ReasonCodePicker
            direction={mode === 'minus' ? 'out' : 'in'}
            value={reason?.id ?? null}
            onChange={setReason}
            compact
          />
          {reason?.requires_note && (
            <input
              type="text"
              inputMode="text"
              placeholder="Reason note (required)"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              className="w-full rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[12px] font-bold text-slate-900 placeholder:font-medium placeholder:text-amber-700/70 focus:border-amber-500 focus:outline-none"
            />
          )}
          {reason?.requires_photo && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                className={`flex-1 rounded-md px-2 py-2 text-[11px] font-black uppercase tracking-widest ${
                  pendingShots.length > 0
                    ? 'bg-emerald-600 text-white'
                    : 'border border-amber-400 bg-amber-100 text-amber-800'
                }`}
              >
                {pendingShots.length > 0
                  ? `📷 ${pendingShots.length} photo${pendingShots.length === 1 ? '' : 's'} ready`
                  : '📷 Take photo (required)'}
              </button>
              {pendingShots.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    pendingShots.forEach((s) => {
                      try {
                        URL.revokeObjectURL(s.previewUrl);
                      } catch {
                        /* ignore */
                      }
                    });
                    setPendingShots([]);
                  }}
                  aria-label="Discard photos"
                  className="rounded-md border border-slate-300 bg-white px-2 py-2 text-[11px] font-bold text-slate-700"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>

        {/* Numpad */}
        <div className="mx-auto grid w-full max-w-sm grid-cols-3 gap-2">
          {KEYS.map((key) => {
            const isAction = key === 'clear' || key === 'back';
            const label =
              key === 'clear'
                ? <X className="mx-auto h-5 w-5" />
                : key === 'back'
                ? '⌫'
                : String(key);
            return (
              <button
                key={String(key)}
                type="button"
                onClick={() => pressKey(key)}
                aria-label={typeof key === 'string' ? key : `digit ${key}`}
                className={`h-16 rounded-lg text-3xl font-black active:scale-95 transition-transform ${
                  isAction
                    ? 'bg-slate-200 text-slate-700'
                    : 'bg-white border border-slate-300 text-slate-900'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {error && (
          <p className="text-center text-sm font-bold text-rose-600">{error}</p>
        )}
      </main>

      {/* ── Confirmation flash ── */}
      {flash && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[130] flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white shadow-lg">
            <Check className="h-4 w-4" />
            {flash}
          </div>
        </div>
      )}

      {/* ── Footer / confirm ── */}
      <footer className="sticky bottom-0 border-t border-slate-200 bg-white px-4 py-3">
        <button
          type="button"
          onClick={confirm}
          disabled={busy || numericDraft <= 0}
          className={`w-full rounded-lg py-4 text-lg font-black text-white shadow-md active:scale-[0.99] transition-transform ${
            mode === 'minus'
              ? 'bg-rose-600 active:bg-rose-700'
              : 'bg-emerald-600 active:bg-emerald-700'
          } disabled:opacity-40`}
        >
          {busy ? (
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          ) : (
            <>Confirm {mode === 'minus' ? `−${numericDraft || 0}` : `+${numericDraft || 0}`}</>
          )}
        </button>
      </footer>

      {cameraOpen && (
        <MobilePackerSpamCamera
          maxPhotos={3}
          header={
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/60">
                Evidence
              </p>
              <p className="truncate text-[13px] font-black text-white">{row.sku}</p>
            </div>
          }
          onDone={(shots) => {
            // Append to any existing batch; release ownership of the blobs.
            setPendingShots((prev) => [...prev, ...shots]);
            setCameraOpen(false);
          }}
          onCancel={() => setCameraOpen(false)}
        />
      )}
    </div>
  );
}
