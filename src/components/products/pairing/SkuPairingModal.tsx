'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { useBodyScrollLock, useEscapeClose } from '@/design-system/hooks';
import { ProductHubPanel } from './ProductHubPanel';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Canonical sku_catalog.id to pair against. */
  skuCatalogId: number | null;
  /**
   * Authoritative title for the panel header — the Zoho product name from the
   * line under test. Passed through so the header shows the real product, not
   * the marketplace catalog title (the SKU namespaces collide).
   */
  headerTitle?: string | null;
}

/**
 * Right-side slide-over that hosts the Product Hub pairing surface — the same
 * confirmed/suggested per-platform display used on the products pairing page,
 * with manual add-by-SKU enabled. Opened from the testing workspace so a tester
 * can pair the line's Zoho SKU to Ecwid/eBay/Amazon/etc. without leaving the
 * flow. Anchored to the right edge (over the workspace panel) rather than
 * centered. Portaled to body so it escapes the workspace's transformed
 * stacking context.
 */
export function SkuPairingModal({ open, onClose, skuCatalogId, headerTitle }: Props) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useBodyScrollLock(open);
  useEscapeClose(open, onClose);

  if (!open || !portalTarget || skuCatalogId == null) return null;

  return createPortal(
    <>
      {/* Light scrim — click to dismiss. Kept subtle so the workspace stays
          visible behind the right-anchored panel. */}
      <div
        className="fixed inset-0 z-modal bg-black/20"
        onClick={onClose}
      />
      <div className="pointer-events-none fixed inset-y-0 right-0 z-modal flex w-full max-w-md p-0 sm:p-3">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sku-pairing-title"
          className="pointer-events-auto flex h-full w-full flex-col overflow-hidden border-l border-border-soft bg-surface-card shadow-2xl sm:rounded-xl sm:border"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border-soft px-3 py-2">
            <p
              id="sku-pairing-title"
              className="text-micro font-black uppercase tracking-[0.16em] text-text-soft"
            >
              Pair SKUs
            </p>
            <IconButton
              type="button"
              onClick={onClose}
              ariaLabel="Close SKU pairing"
              className="rounded p-1 text-text-faint transition-colors hover:bg-surface-sunken hover:text-text-muted"
              icon={<X className="h-4 w-4" />}
            />
          </div>
          <div className="min-h-0 flex-1">
            <ProductHubPanel skuCatalogId={skuCatalogId} allowManualPair headerTitle={headerTitle} />
          </div>
        </div>
      </div>
    </>,
    portalTarget,
  );
}
