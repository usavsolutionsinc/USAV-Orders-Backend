'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Loader2, Minus, Package, Plus, Search, ShoppingCart, Trash2, X } from '@/components/Icons';
import {
  getSidebarIntakeInputClass,
  getSidebarIntakeSubmitButtonClass,
} from '@/design-system/components';
import { useSkuCatalogSearch, type SkuCatalogItem } from '@/hooks/useSkuCatalogSearch';
import { invalidateReceivingCache } from '@/lib/receivingCache';

export type LocalPickupIntakeVariant = 'sidebar' | 'overlay';

export const LOCAL_PICKUP_ADD_LINE_EVENT = 'local-pickup-add-line';
export const LOCAL_PICKUP_CART_STATE_EVENT = 'local-pickup-cart-state';

export type LocalPickupAddLineDetail = {
  sku: string;
  product_title: string;
  category?: string | null;
  image_url?: string | null;
};

export type LocalPickupCartStateDetail = {
  items: Array<{ sku: string; quantity: number }>;
};

const CONDITION_OPTIONS = [
  { value: 'BRAND_NEW', label: 'Brand New' },
  { value: 'USED_A', label: 'Used — A' },
  { value: 'USED_B', label: 'Used — B' },
  { value: 'USED_C', label: 'Used — C' },
  { value: 'PARTS', label: 'Parts Only' },
] as const;

type ConditionGrade = (typeof CONDITION_OPTIONS)[number]['value'];
type PartsStatus = 'COMPLETE' | 'MISSING_PARTS';

interface CartLine {
  key: string;
  sku: string;
  product_title: string;
  category: string | null;
  image_url: string | null;
  quantity: number;
  conditionGrade: ConditionGrade;
  partsStatus: PartsStatus;
  missingPartsNote: string;
  conditionNote: string;
  offerPrice: string;
  total: string;
}

interface LocalPickupIntakeFormProps {
  variant: LocalPickupIntakeVariant;
  staffId?: string | number | null;
  onClose?: () => void;
  onComplete?: (createdReceivingIds: number[]) => void;
}

function parseMoney(raw: string): number {
  const value = Number((raw || '').trim());
  return Number.isFinite(value) ? value : 0;
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function makeLineFromCatalog(item: SkuCatalogItem): CartLine {
  return {
    key: `${item.sku}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sku: item.sku,
    product_title: item.product_title,
    category: item.category,
    image_url: item.image_url,
    quantity: 1,
    conditionGrade: 'USED_A',
    partsStatus: 'COMPLETE',
    missingPartsNote: '',
    conditionNote: '',
    offerPrice: '',
    total: '',
  };
}

export function LocalPickupIntakeForm({
  variant,
  staffId,
  onClose,
  onComplete,
}: LocalPickupIntakeFormProps) {
  const [productSearch, setProductSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const { data: catalogItems = [], isFetching: loadingCatalog } = useSkuCatalogSearch(
    productSearch,
    { ecwidOnly: true, excludeSkuSuffix: '-RS' },
  );

  const greenInputClass = getSidebarIntakeInputClass('green');
  const greenSubmitButtonClass = getSidebarIntakeSubmitButtonClass('green');

  const cartSubtotal = useMemo(
    () =>
      cart.reduce((sum, line) => {
        if (line.total) return sum + parseMoney(line.total);
        return sum + parseMoney(line.offerPrice) * line.quantity;
      }, 0),
    [cart],
  );
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const canSubmit = cart.length > 0 && !isSubmitting;

  const addToCart = useCallback((item: SkuCatalogItem) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.sku === item.sku);
      if (existing) {
        return prev.map((l) =>
          l.sku === item.sku ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [...prev, makeLineFromCatalog(item)];
    });
    setSuccessMessage(null);
  }, []);

  const removeLine = useCallback((key: string) => {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }, []);

  const patchLine = useCallback((key: string, patch: Partial<CartLine>) => {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }, []);

  const adjustQty = useCallback((key: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, quantity: Math.max(0, l.quantity + delta) } : l))
        .filter((l) => l.quantity > 0),
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setSuccessMessage(null);

    const createdReceivingIds: number[] = [];
    const errors: string[] = [];

    for (const line of cart) {
      try {
        const syntheticTracking = `LOCAL-${line.sku}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 6)
          .toUpperCase()}`;

        const entryRes = await fetch('/api/receiving-entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            trackingNumber: syntheticTracking,
            carrier: 'LOCAL',
            conditionGrade: line.conditionGrade,
            qaStatus: 'PASSED',
            dispositionCode: 'ACCEPT',
            isReturn: false,
            needsTest: false,
            targetChannel: 'ORDERS',
            skipZohoMatch: true,
          }),
        });
        if (!entryRes.ok) {
          const err = await entryRes.json().catch(() => ({}));
          throw new Error(err?.error || `HTTP ${entryRes.status}`);
        }
        const entryData = await entryRes.json();
        const receivingId = Number(entryData?.record?.id);
        if (!Number.isFinite(receivingId) || receivingId <= 0) {
          throw new Error('Missing receiving_id from receiving-entry response');
        }
        createdReceivingIds.push(receivingId);

        const offerPriceNumber = parseMoney(line.offerPrice);
        const totalNumber = line.total
          ? parseMoney(line.total)
          : offerPriceNumber * line.quantity;

        const detailRes = await fetch('/api/local-pickups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            receivingId,
            productTitle: line.product_title,
            sku: line.sku,
            quantity: line.quantity,
            partsStatus: line.partsStatus,
            missingPartsNote:
              line.partsStatus === 'MISSING_PARTS' ? line.missingPartsNote : '',
            receivingGrade: line.conditionGrade,
            conditionNote: line.conditionNote,
            offerPrice: line.offerPrice || null,
            total: totalNumber ? totalNumber.toFixed(2) : null,
          }),
        });
        if (!detailRes.ok) {
          const err = await detailRes.json().catch(() => ({}));
          throw new Error(err?.error || `HTTP ${detailRes.status}`);
        }
      } catch (err: any) {
        errors.push(`${line.sku}: ${err?.message || 'Failed'}`);
      }
    }

    invalidateReceivingCache();
    window.dispatchEvent(new CustomEvent('usav-refresh-data'));
    window.dispatchEvent(new CustomEvent('dashboard-refresh'));

    setIsSubmitting(false);

    if (errors.length === 0) {
      setSuccessMessage(
        `Logged ${createdReceivingIds.length} item${createdReceivingIds.length === 1 ? '' : 's'}`,
      );
      setCart([]);
      setProductSearch('');
      onComplete?.(createdReceivingIds);
      setTimeout(() => {
        setSuccessMessage(null);
        searchRef.current?.focus();
      }, 2000);
    } else {
      setSubmitError(errors.join(' · '));
    }
  }, [cart, canSubmit, onComplete]);

  // Focus search on mount (overlay only; sidebar variant has no search block)
  useEffect(() => {
    if (variant !== 'overlay') return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [variant]);

  // ── External "add line" bus — catalog panel dispatches these (sidebar only)
  useEffect(() => {
    if (variant !== 'sidebar') return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<LocalPickupAddLineDetail>).detail;
      if (!detail?.sku) return;
      addToCart({
        id: 0,
        sku: detail.sku,
        product_title: detail.product_title,
        category: detail.category ?? null,
        upc: null,
        image_url: detail.image_url ?? null,
        is_active: true,
      });
    };
    window.addEventListener(LOCAL_PICKUP_ADD_LINE_EVENT, handler);
    return () => window.removeEventListener(LOCAL_PICKUP_ADD_LINE_EVENT, handler);
  }, [addToCart, variant]);

  // ── Broadcast cart state so the catalog panel can show per-card badges ────
  useEffect(() => {
    if (variant !== 'sidebar') return;
    const detail: LocalPickupCartStateDetail = {
      items: cart.map((l) => ({ sku: l.sku, quantity: l.quantity })),
    };
    window.dispatchEvent(
      new CustomEvent<LocalPickupCartStateDetail>(LOCAL_PICKUP_CART_STATE_EVENT, { detail }),
    );
  }, [cart, variant]);

  // ── Shared: search + results ────────────────────────────────────────────────
  const searchBlock = (
    <div className="space-y-2">
      <div className="relative">
        <input
          ref={searchRef}
          type="text"
          value={productSearch}
          onChange={(e) => setProductSearch(e.target.value)}
          placeholder="Search SKU or product title…"
          className={`${greenInputClass} pl-10`}
        />
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        {loadingCatalog && (
          <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-emerald-500" />
        )}
        {productSearch && !loadingCatalog && (
          <button
            type="button"
            onClick={() => setProductSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {productSearch && (
        <div className="overflow-hidden rounded-xl border border-emerald-100 bg-white">
          <div className="max-h-56 overflow-y-auto divide-y divide-gray-50">
            {catalogItems.length === 0 && !loadingCatalog && (
              <p className="px-3 py-3 text-[10px] font-bold text-gray-500">
                No products found
              </p>
            )}
            {catalogItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => addToCart(item)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-emerald-50/60"
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100">
                  {item.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.image_url}
                      alt=""
                      className="h-8 w-8 rounded-lg object-cover"
                    />
                  ) : (
                    <Package className="h-4 w-4 text-gray-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-bold text-gray-900 leading-tight">
                    {item.product_title}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="text-[9px] font-mono font-black uppercase text-emerald-600">
                      {item.sku}
                    </span>
                    {item.category && (
                      <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">
                        {item.category}
                      </span>
                    )}
                  </div>
                </div>
                <Plus className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // ── Shared: one cart-line editor ────────────────────────────────────────────
  const renderCartLine = (line: CartLine) => {
    const isMissing = line.partsStatus === 'MISSING_PARTS';
    return (
      <motion.div
        key={line.key}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.18 }}
        className="rounded-xl border border-gray-200 bg-white p-3 space-y-2.5"
      >
        {/* Header: title + remove */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-bold text-gray-900 leading-tight">
              {line.product_title}
            </p>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-[9px] font-mono font-black uppercase text-emerald-600">
                {line.sku}
              </span>
              {line.category && (
                <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">
                  {line.category}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => removeLine(line.key)}
            className="flex-shrink-0 rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"
            title="Remove line"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Qty + Condition row */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[9px] font-black uppercase tracking-wider text-gray-500 mb-1">
              Qty
            </label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => adjustQty(line.key, -1)}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              >
                <Minus className="h-3 w-3" />
              </button>
              <input
                type="number"
                min={1}
                value={line.quantity}
                onChange={(e) =>
                  patchLine(line.key, { quantity: Math.max(1, Number(e.target.value) || 1) })
                }
                className="h-7 w-12 rounded-md border border-gray-200 bg-white text-center text-[11px] font-black text-gray-900 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={() => adjustQty(line.key, 1)}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[9px] font-black uppercase tracking-wider text-gray-500 mb-1">
              Condition
            </label>
            <select
              value={line.conditionGrade}
              onChange={(e) =>
                patchLine(line.key, { conditionGrade: e.target.value as ConditionGrade })
              }
              className="h-7 w-full rounded-md border border-gray-200 bg-white px-2 text-[10px] font-bold text-gray-900 focus:outline-none focus:border-emerald-500"
            >
              {CONDITION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Parts status + missing parts note */}
        <div>
          <label className="block text-[9px] font-black uppercase tracking-wider text-gray-500 mb-1">
            Parts
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => patchLine(line.key, { partsStatus: 'COMPLETE' })}
              className={`h-7 rounded-md text-[9px] font-black uppercase tracking-wider transition-colors ${
                !isMissing
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              Complete
            </button>
            <button
              type="button"
              onClick={() => patchLine(line.key, { partsStatus: 'MISSING_PARTS' })}
              className={`h-7 rounded-md text-[9px] font-black uppercase tracking-wider transition-colors ${
                isMissing
                  ? 'bg-amber-500 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              Missing Parts
            </button>
          </div>
          {isMissing && (
            <textarea
              value={line.missingPartsNote}
              onChange={(e) => patchLine(line.key, { missingPartsNote: e.target.value })}
              placeholder="List missing parts…"
              className="mt-1.5 min-h-[44px] w-full rounded-md border border-amber-200 bg-amber-50/50 px-2 py-1.5 text-[11px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-amber-400"
            />
          )}
        </div>

        {/* Condition note */}
        <div>
          <label className="block text-[9px] font-black uppercase tracking-wider text-gray-500 mb-1">
            Condition note
          </label>
          <textarea
            value={line.conditionNote}
            onChange={(e) => patchLine(line.key, { conditionNote: e.target.value })}
            placeholder="What's wrong or notable about the unit…"
            className="min-h-[44px] w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-emerald-400"
          />
        </div>

        {/* Offer + Total */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[9px] font-black uppercase tracking-wider text-gray-500 mb-1">
              Offer $
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={line.offerPrice}
              onChange={(e) => patchLine(line.key, { offerPrice: e.target.value })}
              placeholder="0.00"
              className="h-7 w-full rounded-md border border-gray-200 bg-white px-2 text-[11px] font-bold text-gray-900 focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-[9px] font-black uppercase tracking-wider text-gray-500 mb-1">
              Total $
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={line.total}
              onChange={(e) => patchLine(line.key, { total: e.target.value })}
              placeholder={
                line.offerPrice
                  ? (parseMoney(line.offerPrice) * line.quantity).toFixed(2)
                  : '0.00'
              }
              className="h-7 w-full rounded-md border border-gray-200 bg-white px-2 text-[11px] font-bold text-emerald-700 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>
      </motion.div>
    );
  };

  // ── Shared: summary + submit button ─────────────────────────────────────────
  const footerBlock = (
    <div className="space-y-2">
      {cart.length > 0 && (
        <div className="flex items-center justify-between border-t border-gray-200 pt-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-gray-500">
            Subtotal
          </span>
          <span className="text-[13px] font-black text-emerald-600">
            {formatMoney(cartSubtotal)}
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className={`flex w-full items-center justify-center gap-2 ${greenSubmitButtonClass}`}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Logging…
          </>
        ) : successMessage ? (
          <>
            <Check className="h-4 w-4" /> {successMessage}
          </>
        ) : (
          <>
            <ShoppingCart className="h-4 w-4" />
            {cart.length > 0
              ? `Log ${cartCount} Item${cartCount === 1 ? '' : 's'}`
              : 'Add Products'}
          </>
        )}
      </button>
      {submitError && (
        <p className="text-center text-[9px] font-bold text-red-600">{submitError}</p>
      )}
    </div>
  );

  // ── Sidebar variant: single narrow column ───────────────────────────────────
  if (variant === 'sidebar') {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
        <div className="border-b border-gray-100 px-3 py-2.5">
          <p className="text-[9px] font-black uppercase tracking-widest text-emerald-500">
            Local Pickup
          </p>
          <h3 className="mt-0.5 text-[12px] font-black uppercase tracking-tight text-gray-900">
            New Intake
          </h3>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {cart.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 p-4 text-center">
              <ShoppingCart className="mx-auto mb-1 h-5 w-5 text-gray-300" />
              <p className="text-[10px] font-bold text-gray-400">
                Pick products from the catalog →
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {cart.map((line) => renderCartLine(line))}
              </AnimatePresence>
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 bg-white px-3 py-2.5">{footerBlock}</div>
      </div>
    );
  }

  // ── Overlay variant: wide two-column inside LocalPickupTable ────────────────
  return (
    <div className="flex h-full min-h-0 w-full bg-gray-50">
      <aside className="flex w-[380px] shrink-0 flex-col border-r border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-emerald-500">
              Local Pickup
            </p>
            <h2 className="mt-0.5 text-[14px] font-black uppercase tracking-tight text-gray-900">
              New Intake
            </h2>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {searchBlock}
        </div>

        <div className="border-t border-gray-100 bg-white px-5 py-3">{footerBlock}</div>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-gray-200 bg-white px-5 py-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">
            Cart
          </p>
          <p className="text-[11px] font-bold text-gray-600">
            {cart.length === 0
              ? 'Add products from the left to start'
              : `${cart.length} product${cart.length === 1 ? '' : 's'} · ${cartCount} unit${cartCount === 1 ? '' : 's'}`}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {cart.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-xs text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
                  <ShoppingCart className="h-7 w-7 text-emerald-300" />
                </div>
                <p className="text-[12px] font-bold text-gray-500">Cart is empty</p>
                <p className="mt-1 text-[10px] text-gray-400">
                  Search the catalog on the left to add products to this pickup
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-auto grid max-w-3xl gap-3 md:grid-cols-2">
              <AnimatePresence initial={false}>
                {cart.map((line) => renderCartLine(line))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
