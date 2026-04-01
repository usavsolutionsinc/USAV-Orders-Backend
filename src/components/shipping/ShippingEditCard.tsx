'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Check, Package, Loader2 } from '@/components/Icons';
import { AssignmentOverlayCard } from '@/design-system/components/AssignmentOverlayCard';
import { OrderIdChip } from '@/design-system/components/CopyChip';
import { getOrderPlatformLabel, getOrderPlatformColor } from '@/utils/order-platform';
import { useOrderAssignment } from '@/hooks/useOrderAssignment';
import type { ShippedOrder } from '@/lib/neon/orders-queries';

export interface ShippingEditCardProps {
  orders: ShippedOrder[];
  startIndex: number;
  onClose: () => void;
  onUpdate?: () => void;
  storageKey?: string;
}

/**
 * Mobile-first card for scanning shipping tracking numbers into orders.
 * Carousel navigation between orders — scan or type a tracking number, hit enter or tap Save.
 * All other order editing is handled by ShippingInformationSection in the detail panel.
 */
export function ShippingEditCard({
  orders,
  startIndex,
  onClose,
  onUpdate,
}: ShippingEditCardProps) {
  const [index, setIndex] = useState(() => Math.max(0, Math.min(startIndex, orders.length - 1)));
  const [trackingValue, setTrackingValue] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const assignMutation = useOrderAssignment();

  const row = orders[index];
  const hasPrev = index > 0;
  const hasNext = index < orders.length - 1;

  // Sync input when navigating to a new order
  useEffect(() => {
    if (!row) return;
    setTrackingValue(row.shipping_tracking_number ?? '');
    setSaveState('idle');
    // Auto-focus the input after a short delay (mobile keyboard)
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [row?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const navigate = useCallback((dir: 'prev' | 'next') => {
    const next = dir === 'next' ? index + 1 : index - 1;
    if (next < 0 || next >= orders.length) return;
    setIndex(next);
  }, [index, orders.length]);

  // Save tracking number
  const saveTracking = useCallback(async () => {
    if (!row) return;
    const trimmed = trackingValue.trim();
    const current = (row.shipping_tracking_number ?? '').trim();
    if (trimmed === current) {
      // Nothing changed — just advance
      if (hasNext) navigate('next');
      return;
    }

    setSaveState('saving');
    try {
      await assignMutation.mutateAsync({
        orderId: row.id,
        shippingTrackingNumber: trimmed || null,
      });
      setSaveState('saved');
      onUpdate?.();
      // Auto-advance to next order after successful save
      setTimeout(() => {
        if (hasNext) navigate('next');
        else setSaveState('idle');
      }, 400);
    } catch {
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 2000);
    }
  }, [row, trackingValue, hasNext, navigate, assignMutation, onUpdate]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    void saveTracking();
  }, [saveTracking]);

  // Keyboard navigation (when input not focused)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!row) return null;

  const platformLabel = getOrderPlatformLabel(row.order_id, row.account_source);
  const platformColor = getOrderPlatformColor(platformLabel);
  const hasTracking = Boolean((row.shipping_tracking_number ?? '').trim());
  const serialCount = row.serial_number ? row.serial_number.split(',').filter((s) => s.trim()).length : 0;

  return (
    <AssignmentOverlayCard
      onClose={onClose}
      widthClassName="w-[96vw] max-w-[420px]"
      dialogPosition="bottom"
      showHeaderGradient={false}
      bodyClassName="p-0"
      showCloseButton
    >
      {/* ── Navigation ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-gray-100">
        <button
          type="button"
          disabled={!hasPrev}
          onClick={() => navigate('prev')}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 active:bg-gray-200 disabled:opacity-20"
          aria-label="Previous order"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-gray-400">
            {index + 1} / {orders.length}
          </p>
        </div>
        <button
          type="button"
          disabled={!hasNext}
          onClick={() => navigate('next')}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 active:bg-gray-200 disabled:opacity-20"
          aria-label="Next order"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* ── Order info ──────────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-2">
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={row.id}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.15 }}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-white"
                style={{ backgroundColor: platformColor }}
              >
                {platformLabel}
              </span>
              {row.order_id && <OrderIdChip value={row.order_id} display={row.order_id} />}
              {hasTracking && (
                <span className="ml-auto shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-emerald-700">
                  Has Tracking
                </span>
              )}
            </div>
            <p className="text-[15px] font-black leading-snug tracking-tight text-gray-900 line-clamp-2">
              {row.product_title || 'Untitled Order'}
            </p>
            <div className="mt-1 flex items-center gap-3 text-[10px] font-bold text-gray-500">
              {row.sku && <span>SKU: {row.sku}</span>}
              {row.quantity && <span>Qty: {row.quantity}</span>}
              {serialCount > 0 && <span>{serialCount} serial{serialCount !== 1 ? 's' : ''}</span>}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Tracking scan input ─────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="px-4 pb-4 pt-2">
        <label className="block mb-1.5 text-[9px] font-black uppercase tracking-[0.22em] text-gray-500">
          Shipping Tracking Number
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={trackingValue}
            onChange={(e) => {
              setTrackingValue(e.target.value);
              setSaveState('idle');
            }}
            placeholder="Scan or type tracking number"
            autoComplete="off"
            autoCapitalize="characters"
            enterKeyHint="done"
            className="flex-1 h-12 rounded-xl border-2 border-gray-200 bg-white px-4 text-[14px] font-bold text-gray-900 font-mono outline-none transition-all placeholder:font-sans placeholder:font-normal placeholder:text-gray-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
          />
          <button
            type="submit"
            disabled={saveState === 'saving'}
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-all active:scale-95 ${
              saveState === 'saved'
                ? 'bg-emerald-500 text-white'
                : saveState === 'error'
                  ? 'bg-red-500 text-white'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
            aria-label="Save tracking number"
          >
            {saveState === 'saving' ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : saveState === 'saved' ? (
              <Check className="h-5 w-5" />
            ) : (
              <Package className="h-5 w-5" />
            )}
          </button>
        </div>
        {saveState === 'error' && (
          <p className="mt-1.5 text-[10px] font-bold text-red-600">Failed to save. Try again.</p>
        )}
        {saveState === 'saved' && (
          <p className="mt-1.5 text-[10px] font-bold text-emerald-600">Tracking saved.</p>
        )}
      </form>
    </AssignmentOverlayCard>
  );
}
