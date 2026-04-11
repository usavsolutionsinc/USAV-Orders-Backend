'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Minus, Plus, X, Check } from '@/components/Icons';
import { sectionLabel, fieldLabel } from '@/design-system/tokens/typography/presets';
import type { BinContentRow, BinLocation } from './BinContentsView';

// ─── Types ──────────────────────────────────────────────────────────────────

interface QtyEditBottomSheetProps {
  isOpen: boolean;
  row: BinContentRow | null;
  location: BinLocation | null;
  onClose: () => void;
  /** Called after a successful PATCH so parent can refresh the bin. */
  onUpdated: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Slide-up bottom sheet for adjusting the qty of a single SKU in a bin.
 *
 * Uses PATCH /api/locations/[barcode] with { action: 'take' | 'put', qty }.
 * The delta is computed from absolute target qty the user dials in:
 *   target > current → put (delta)
 *   target < current → take (delta)
 *   target = current → no-op
 */
export function QtyEditBottomSheet({
  isOpen,
  row,
  location,
  onClose,
  onUpdated,
}: QtyEditBottomSheetProps) {
  const [target, setTarget] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state whenever a new row is opened
  useEffect(() => {
    if (isOpen && row) {
      setTarget(row.qty);
      setError(null);
      setSaving(false);
    }
  }, [isOpen, row]);

  const decrement = useCallback(() => setTarget((t) => Math.max(0, t - 1)), []);
  const increment = useCallback(() => setTarget((t) => t + 1), []);

  const handleConfirm = useCallback(async () => {
    if (!row || !location?.barcode) return;
    const delta = target - row.qty;
    if (delta === 0) {
      onClose();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/locations/${encodeURIComponent(location.barcode)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: delta > 0 ? 'put' : 'take',
          sku: row.sku,
          qty: Math.abs(delta),
          reason: delta > 0 ? 'RECEIVED' : 'TAKEN',
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to update qty');
      onUpdated();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to update qty');
    } finally {
      setSaving(false);
    }
  }, [row, location, target, onClose, onUpdated]);

  const delta = row ? target - row.qty : 0;
  const canConfirm = !saving && row != null && delta !== 0 && target >= 0;

  return (
    <AnimatePresence>
      {isOpen && row && location && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="fixed inset-0 z-[150] bg-black/50"
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            className="fixed inset-x-0 bottom-0 z-[151] flex flex-col rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-20px_50px_rgba(0,0,0,0.25)]"
          >
            {/* Grab handle */}
            <div className="flex justify-center pt-2.5 pb-1">
              <div className="h-1 w-10 rounded-full bg-gray-300" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-2 pb-3">
              <div className="min-w-0">
                <p className={sectionLabel}>Adjust Quantity</p>
                <p className="mt-1 truncate text-[11px] font-black font-mono text-gray-900">
                  {row.sku}
                </p>
                {row.productTitle && (
                  <p className="mt-0.5 truncate text-[10px] font-bold text-gray-500">
                    {row.productTitle}
                  </p>
                )}
                <p className="mt-0.5 text-[9px] font-black uppercase tracking-widest text-gray-400">
                  {location.room} · {location.barcode}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="h-9 w-9 flex-shrink-0 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center active:bg-gray-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Current qty label */}
            <div className="flex items-center justify-between px-5 pb-2">
              <span className={fieldLabel}>Current</span>
              <span className="text-[13px] font-black tabular-nums text-gray-500">
                {row.qty}
              </span>
            </div>

            {/* Stepper */}
            <div className="flex items-center justify-center gap-4 px-5 py-6">
              <button
                type="button"
                onClick={decrement}
                disabled={saving || target <= 0}
                aria-label="Decrease quantity"
                className="h-16 w-16 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center active:bg-red-100 disabled:opacity-30 transition-colors"
              >
                <Minus className="h-6 w-6" />
              </button>
              <div className="flex flex-col items-center min-w-[120px]">
                <input
                  type="number"
                  inputMode="numeric"
                  value={target}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setTarget(isFinite(n) && n >= 0 ? n : 0);
                  }}
                  disabled={saving}
                  className="w-full text-center text-[36px] font-black tabular-nums text-gray-900 outline-none focus:text-blue-600"
                />
                {delta !== 0 && (
                  <span
                    className={`text-[10px] font-black uppercase tracking-widest ${
                      delta > 0 ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {delta > 0 ? '+' : ''}
                    {delta}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={increment}
                disabled={saving}
                aria-label="Increase quantity"
                className="h-16 w-16 rounded-2xl bg-green-50 text-green-600 flex items-center justify-center active:bg-green-100 disabled:opacity-30 transition-colors"
              >
                <Plus className="h-6 w-6" />
              </button>
            </div>

            {/* Error */}
            {error && (
              <p className="mx-5 mb-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600">
                {error}
              </p>
            )}

            {/* Confirm button */}
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="mx-5 mb-5 h-14 rounded-2xl bg-blue-600 text-white text-[12px] font-black uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40 active:bg-blue-700 transition-colors"
            >
              {saving ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  {delta === 0
                    ? 'No change'
                    : delta > 0
                      ? `Add ${delta}`
                      : `Remove ${Math.abs(delta)}`}
                </>
              )}
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
