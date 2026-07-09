'use client';

import { useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Link2, Clipboard, Check, Loader2, ChevronLeft, ChevronRight, X } from '@/components/Icons';
import { Button, IconButton } from '@/design-system/primitives';
import { AddValueChipFace } from '@/components/ui/CopyChip';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { useOrderAssignment } from '@/hooks/useOrderAssignment';
import { useOrderChannelLabel } from '@/hooks/useCatalog';
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
  const orderChannelLabel = useOrderChannelLabel();
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

  const platformLabel = orderChannelLabel(record.order_id || '', record.account_source);
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
        {/* ds-raw-button: single child of Radix <Popover.Trigger asChild> — the Slot clones onto it; a DS Button would disturb the single-child clone + title */}
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          // ds-allow-title: single child of Radix <Popover.Trigger asChild> — wrapping it would break the trigger.
          title="Add tracking number + complete this order"
          // `px-1.5` mirrors CopyChip's `outerPad='chip'` gutter so this empty
          // state lines up flush with the filled TrackingChip in the ChipColumns
          // grid (whose `-mr-1.5` cancels that same trailing gutter).
          className="inline-flex shrink-0 items-center px-1.5 transition-colors"
        >
          <AddValueChipFace label="Add TRK#" icon={<Link2 className="h-3.5 w-3.5 shrink-0" />} size="chip" />
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
          className="z-dropdown w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-border-soft bg-surface-card p-3 shadow-xl ring-1 ring-black/5 focus:outline-none"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className={`${sectionLabel} text-violet-700`}>Add Tracking</span>
            <div className="flex items-center gap-1">
              {pos && pos.total > 0 ? (
                <span className="text-eyebrow font-bold tabular-nums text-text-faint">{pos.index} / {pos.total}</span>
              ) : null}
              <Popover.Close className="rounded p-0.5 text-text-faint hover:bg-surface-sunken hover:text-text-muted" aria-label="Close">
                <X className="h-3.5 w-3.5" />
              </Popover.Close>
            </div>
          </div>

          <div className="mb-3 rounded-xl bg-surface-canvas px-3 py-2">
            <p className="truncate text-caption font-bold text-text-default">{record.product_title || 'Unknown product'}</p>
            <p className="mt-0.5 text-eyebrow font-semibold uppercase tracking-wide text-text-faint">
              {[platformLabel, record.order_id ? `#${record.order_id}` : null, `${record.condition || 'N/A'} · ×${qty}`]
                .filter(Boolean)
                .join('  ·  ')}
            </p>
          </div>

          <label className="mb-1 block text-eyebrow font-black uppercase tracking-wider text-text-soft">Tracking #</label>
          <div className="mb-3 flex items-center gap-1.5">
            <input
              ref={trackingRef}
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="Paste or scan tracking…"
              className="min-w-0 flex-1 rounded-xl border border-border-soft bg-surface-card px-3 py-2 font-mono text-caption text-text-default outline-none transition-all focus:border-violet-500"
            />
            <HoverTooltip label="Paste from clipboard" asChild>
              <IconButton
                icon={<Clipboard className="h-4 w-4" />}
                onClick={handlePaste}
                ariaLabel="Paste from clipboard"
                className="shrink-0 rounded-xl border border-border-soft p-2 text-text-soft hover:bg-surface-hover hover:text-violet-600"
              />
            </HoverTooltip>
          </div>

          <label className="mb-1 block text-eyebrow font-black uppercase tracking-wider text-text-soft">SKU</label>
          <input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder="SKU"
            className="mb-1 w-full rounded-xl border border-border-soft bg-surface-card px-3 py-2 font-mono text-caption text-text-default outline-none transition-all focus:border-violet-500"
          />
          {sku.trim() && sku.trim() !== initialSku ? (
            <p className="mb-2 flex items-center gap-1 text-eyebrow font-semibold">
              {resolving ? (
                <span className="text-text-faint">Looking up…</span>
              ) : resolution?.skuCatalogId != null ? (
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  <Check className="h-3 w-3" /> Linked: {resolution.title || 'catalog match'}
                </span>
              ) : (
                <span className="text-amber-600">No catalog match — will save the SKU text only</span>
              )}
            </p>
          ) : null}

          <label className="mb-1 block text-eyebrow font-black uppercase tracking-wider text-text-soft">Item #</label>
          <input
            value={itemNumber}
            onChange={(e) => setItemNumber(e.target.value)}
            placeholder="Item number"
            className="mb-3 w-full rounded-xl border border-border-soft bg-surface-card px-3 py-2 font-mono text-caption text-text-default outline-none transition-all focus:border-violet-500"
          />

          {status === 'error' ? (
            <p className="mb-2 text-eyebrow font-bold text-red-600">Save failed — try again.</p>
          ) : null}

          <div className="flex items-center gap-1.5">
            <HoverTooltip label="Previous order" asChild>
              <IconButton
                icon={<ChevronLeft className="h-4 w-4" />}
                onClick={() => nav?.prev(orderId)}
                disabled={!nav?.hasPrev(orderId)}
                ariaLabel="Previous order"
                className="rounded-xl border border-border-soft p-2 text-text-soft hover:bg-surface-hover disabled:opacity-30"
              />
            </HoverTooltip>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!canSave}
              icon={status === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              className="flex-1 bg-violet-600 text-white shadow-violet-600/25 hover:bg-violet-700 active:scale-95"
            >
              {nav?.hasNext(orderId) ? 'Save & Next' : 'Save'}
            </Button>
            <HoverTooltip label="Next order" asChild>
              <IconButton
                icon={<ChevronRight className="h-4 w-4" />}
                onClick={() => nav?.next(orderId)}
                disabled={!nav?.hasNext(orderId)}
                ariaLabel="Next order"
                className="rounded-xl border border-border-soft p-2 text-text-soft hover:bg-surface-hover disabled:opacity-30"
              />
            </HoverTooltip>
          </div>

          {nav && nav.recentlyAdded.length > 0 ? (
            <div className="mt-3 border-t border-border-hairline pt-2">
              <p className="mb-1 text-eyebrow font-black uppercase tracking-wider text-text-faint">Recently added</p>
              <ul className="space-y-0.5">
                {nav.recentlyAdded.slice(0, 5).map((e) => (
                  <li key={e.orderId} className="flex items-center justify-between gap-2 text-eyebrow">
                    <span className="truncate text-text-muted">{e.title}</span>
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
