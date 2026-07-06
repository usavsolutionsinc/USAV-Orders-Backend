'use client';

import { AnimatePresence } from 'framer-motion';
import { Loader2 } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import DeleteButton from '@/components/ui/DeleteButton';
import { DetailStackRailRegistrar } from '@/components/right-rail/DetailStackRailRegistrar';
import { useSkuDetailView } from './sku-detail/useSkuDetailView';
import type { SkuDetailViewProps } from './sku-detail/sku-detail-types';
import { SkuDetailHeader } from './sku-detail/SkuDetailHeader';
import { SkuStockCard } from './sku-detail/SkuStockCard';
import { SkuLocationCard } from './sku-detail/SkuLocationCard';
import { SkuDetailCards } from './sku-detail/SkuDetailCards';
import { PhotoViewerModal } from '@/components/shipped/photo-gallery/PhotoViewerModal';

/**
 * SKU detail view (panel slide-over or full page). Thin composition layer —
 * data/edit/deactivate logic lives in {@link useSkuDetailView}; the cards live
 * under `./sku-detail/`.
 */
export default function SkuDetailView({ sku, variant = 'page', onClose }: SkuDetailViewProps) {
  const c = useSkuDetailView({ sku, variant, onClose });
  const { data, isPanel } = c;

  const wrapPanel = (content: React.ReactNode) => {
    if (!isPanel || !onClose) return content;
    return (
      <DetailStackRailRegistrar id={`detail:sku:${sku}`} onClose={c.handleClose}>
        <div className="flex h-full min-h-0 flex-col overflow-hidden">{content}</div>
      </DetailStackRailRegistrar>
    );
  };

  if (c.loading) {
    return wrapPanel(
      <div className="flex h-full items-center justify-center bg-surface-canvas">
        <div className="text-center">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm font-semibold text-text-muted">Loading SKU detail...</p>
        </div>
      </div>,
    );
  }

  if (c.error && !data) {
    return wrapPanel(
      <div className="flex h-full flex-col items-center justify-center bg-surface-canvas px-6">
        <p className="mb-4 text-sm font-bold text-red-600">{c.error}</p>
        <Button variant="ghost" onClick={c.handleClose} className="text-sm font-bold text-blue-600 underline">
          Back to SKU Stock
        </Button>
      </div>,
    );
  }

  if (!data) return isPanel ? wrapPanel(null) : null;

  return wrapPanel(
    <div className="flex h-full min-h-0 flex-col bg-surface-canvas">
      <SkuDetailHeader c={c} data={data} />

      <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4">
        {data.productImage && (
          <div className="rounded-xl bg-surface-card border border-border-soft overflow-hidden">
            <img src={data.productImage} alt={data.productTitle || data.sku} className="w-full h-48 object-contain bg-surface-canvas" loading="eager" />
          </div>
        )}

        <SkuStockCard c={c} data={data} />
        <SkuLocationCard c={c} data={data} />
        <SkuDetailCards c={c} data={data} />
      </div>

      {/* Footer: deactivate (panel only, active catalog SKUs) */}
      {isPanel && data.catalog?.isActive ? (
        <div className="flex-shrink-0 border-t border-border-soft bg-surface-card px-4 py-3">
          {c.deactivateError ? <p className="mb-2 text-caption font-semibold text-rose-600">{c.deactivateError}</p> : null}
          <DeleteButton
            onConfirm={c.handleDeactivate}
            onDeleted={c.handleClose}
            label="Deactivate SKU"
            armedLabel="Click again to deactivate"
            className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 text-caption font-bold text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
      ) : null}

      <AnimatePresence>
        {c.gallery.viewerOpen ? <PhotoViewerModal g={c.gallery} /> : null}
      </AnimatePresence>
    </div>,
  );
}
