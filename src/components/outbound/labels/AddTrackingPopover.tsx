'use client';

import { useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Link2, Clipboard, Check, Loader2, ChevronLeft, ChevronRight, X } from '@/components/Icons';
import { AddValueChipFace } from '@/components/ui/CopyChip';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { useOrderAssignment } from '@/hooks/useOrderAssignment';
import { getOrderPlatformLabel } from '@/utils/order-platform';
import type { ShippedOrder } from '@/lib/neon/orders-queries';
import { useAddTrackingNav } from '@/components/outbound/labels/add-tracking-context';

interface SkuResolution {
  title: string | null;
  skuCatalogId: number | null;
}

/**
 * Rich "Add TRK#" popover for Outbound · Labels: order identity, tracking input,
 * fill-missing SKU/item# (via get-title-by-sku → sku_catalog_id), prev/next
 * worklist nav, and a session "recently added" log.
 */
export function AddTrackingPopover({ record }: { record: ShippedOrder }) {
  const orderId = Number(record.id);
  const nav = useAddTrackingNav();
  const mutation = useOrderAssignment();
  const [localOpen, setLocalOpen] = useState(false);
  const open = nav ? nav.openOrderId === orderId : localOpen;

  const setOpen = (next: boolean) => {
    if (nav) {
      if (next) nav.open(orderId);
      else nav.close();
    } else {
      setLocalOpen(next);
    }
  };

  const initialSku = (record.sku || '').trim();
  const initialItem = String(record.item_number || '').trim();
  const [tracking, setTracking] = useState('');
  const [sku, setSku] = useState(initialSku);
  const [itemNumber, setItemNumber] = useState(initialItem);
  const [resolution, setResolution] = useState<SkuResolution | null>(null);
  const [resolving, setResolving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const trackingRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setTracking('');
    setSku(initialSku);
    setItemNumber(initialItem);
    setResolution(null);
    setStatus('idle');
    const t = setTimeout(() => trackingRef.current?.focus(), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const trimmed = sku.trim();
    if (!open || !trimmed || trimmed === initialSku) {
      setResolution(null);
      setResolving(false);
      return;
    }
    let cancelled = false;
    setResolving(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/get-title-by-sku?sku=${encodeURIComponent(trimmed)}`);
        if (!res.ok) throw new Error('lookup failed');
        const data = await res.json();
        if (cancelled) return;
        setResolution({
          title: data?.title ?? null,
          skuCatalogId: data?.skuCatalogId != null ? Number(data.skuCatalogId) : null,
        });
      } catch {
        if (!cancelled) setResolution(null);
      } finally {
        if (!cancelled) setResolving(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sku, open]);

  const platformLabel = getOrderPlatformLabel(record.order_id || '', record.account_source);
  const qty = parseInt(String(record.quantity || '1'), 10) || 1;
  const pos = nav?.positionOf(orderId);

  const trimmedTracking = tracking.trim();
  const skuChanged = sku.trim() !== initialSku;
  const itemChanged = itemNumber.trim() !== initialItem;
  const canSave = (Boolean(trimmedTracking) || skuChanged || itemChanged) && status !== 'saving';

  const handlePaste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) setTracking(text);
      trackingRef.current?.focus();
    } catch {
      /* clipboard blocked */
    }
  };

  const handleSave = async () => {
    if (!canSave) return;
    setStatus('saving');
    try {
      await mutation.mutateAsync({
        orderId,
        ...(trimmedTracking ? { shippingTrackingNumber: trimmedTracking } : {}),
        ...(skuChanged ? { sku: sku.trim() || null } : {}),
        ...(skuChanged && resolution?.skuCatalogId != null ? { skuCatalogId: resolution.skuCatalogId } : {}),
        ...(itemChanged ? { itemNumber: itemNumber.trim() || null } : {}),
      });
      if (trimmedTracking) {
        nav?.pushRecentlyAdded({
          orderId,
          title: record.product_title || record.order_id || `Order ${orderId}`,
          tracking: trimmedTracking,
        });
      }
      if (nav?.hasNext(orderId)) nav.next(orderId);
      else setOpen(false);
    } catch {
      setStatus('error');
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          title="Add tracking number + complete this order"
          className="inline-flex shrink-0 items-center transition-colors"
        >
          <AddValueChipFace label="Add TRK#" icon={<Link2 className="h-3.5 w-3.5 shrink-0" />} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void handleSave(); }
          }}
          className="z-dropdown w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-gray-200 bg-white p-3 shadow-xl ring-1 ring-black/5 focus:outline-none"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className={`${sectionLabel} text-violet-700`}>Add Tracking</span>
            <div className="flex items-center gap-1">
              {pos && pos.total > 0 ? (
                <span className="text-eyebrow font-bold tabular-nums text-gray-400">{pos.index} / {pos.total}</span>
              ) : null}
              <Popover.Close className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close">
                <X className="h-3.5 w-3.5" />
              </Popover.Close>
            </div>
          </div>

          <div className="mb-3 rounded-xl bg-gray-50 px-3 py-2">
            <p className="truncate text-caption font-bold text-gray-900">{record.product_title || 'Unknown product'}</p>
            <p className="mt-0.5 text-eyebrow font-semibold uppercase tracking-wide text-gray-400">
              {[platformLabel, record.order_id ? `#${record.order_id}` : null, `${record.condition || 'N/A'} · ×${qty}`]
                .filter(Boolean)
                .join('  ·  ')}
            </p>
          </div>

          <label className="mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500">Tracking #</label>
          <div className="mb-3 flex items-center gap-1.5">
            <input
              ref={trackingRef}
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="Paste or scan tracking…"
              className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-caption text-gray-900 outline-none transition-all focus:border-violet-500"
            />
            <button
              type="button"
              onClick={handlePaste}
              title="Paste from clipboard"
              className="shrink-0 rounded-xl border border-gray-200 p-2 text-gray-500 transition-colors hover:bg-gray-50 hover:text-violet-600"
            >
              <Clipboard className="h-4 w-4" />
            </button>
          </div>

          <label className="mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500">SKU</label>
          <input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder="SKU"
            className="mb-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-caption text-gray-900 outline-none transition-all focus:border-violet-500"
          />
          {sku.trim() && sku.trim() !== initialSku ? (
            <p className="mb-2 flex items-center gap-1 text-eyebrow font-semibold">
              {resolving ? (
                <span className="text-gray-400">Looking up…</span>
              ) : resolution?.skuCatalogId != null ? (
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  <Check className="h-3 w-3" /> Linked: {resolution.title || 'catalog match'}
                </span>
              ) : (
                <span className="text-amber-600">No catalog match — will save the SKU text only</span>
              )}
            </p>
          ) : null}

          <label className="mb-1 block text-eyebrow font-black uppercase tracking-wider text-gray-500">Item #</label>
          <input
            value={itemNumber}
            onChange={(e) => setItemNumber(e.target.value)}
            placeholder="Item number"
            className="mb-3 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-caption text-gray-900 outline-none transition-all focus:border-violet-500"
          />

          {status === 'error' ? (
            <p className="mb-2 text-eyebrow font-bold text-red-600">Save failed — try again.</p>
          ) : null}

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => nav?.prev(orderId)}
              disabled={!nav?.hasPrev(orderId)}
              className="rounded-xl border border-gray-200 p-2 text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-30"
              title="Previous order"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-white transition-all hover:bg-violet-700 active:scale-95 disabled:opacity-40 ${sectionLabel} !text-white`}
            >
              {status === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {nav?.hasNext(orderId) ? 'Save & Next' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => nav?.next(orderId)}
              disabled={!nav?.hasNext(orderId)}
              className="rounded-xl border border-gray-200 p-2 text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-30"
              title="Next order"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {nav && nav.recentlyAdded.length > 0 ? (
            <div className="mt-3 border-t border-gray-100 pt-2">
              <p className="mb-1 text-eyebrow font-black uppercase tracking-wider text-gray-400">Recently added</p>
              <ul className="space-y-0.5">
                {nav.recentlyAdded.slice(0, 5).map((e) => (
                  <li key={e.orderId} className="flex items-center justify-between gap-2 text-eyebrow">
                    <span className="truncate text-gray-600">{e.title}</span>
                    <span className="shrink-0 font-mono font-semibold text-emerald-600">…{e.tracking.slice(-6)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
