'use client';

import { motion } from 'framer-motion';
import { Loader2 } from '@/components/Icons';
import { SlideOverBackdrop } from '@/components/ui/SlideOverBackdrop';
import DeleteButton from '@/components/ui/DeleteButton';
import { useSkuDetailView } from './sku-detail/useSkuDetailView';
import type { SkuDetailViewProps } from './sku-detail/sku-detail-types';
import { SkuDetailHeader } from './sku-detail/SkuDetailHeader';
import { SkuStockCard } from './sku-detail/SkuStockCard';
import { SkuLocationCard } from './sku-detail/SkuLocationCard';
import { SkuDetailCards } from './sku-detail/SkuDetailCards';
import { SkuPhotoLightbox } from './sku-detail/SkuPhotoLightbox';

/**
 * SKU detail view (panel slide-over or full page). Thin composition layer —
 * data/edit/deactivate logic lives in {@link useSkuDetailView}; the cards live
 * under `./sku-detail/`.
 */
export default function SkuDetailView({ sku, variant = 'page', onClose }: SkuDetailViewProps) {
  const c = useSkuDetailView({ sku, variant, onClose });
  const { data, isPanel } = c;

  const wrapPanel = (content: React.ReactNode) => {
    if (!isPanel) return content;
    return (
      <>
        <SlideOverBackdrop onClose={c.handleClose} />
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 350, mass: 0.5 }}
          className="fixed right-0 top-0 z-panel flex h-screen w-[420px] max-w-full flex-col overflow-hidden border-l border-gray-200 bg-white shadow-[-20px_0_50px_rgba(0,0,0,0.05)]"
        >
          {content}
        </motion.div>
      </>
    );
  };

  if (c.loading) {
    return wrapPanel(
      <div className="flex h-full items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm font-semibold text-gray-600">Loading SKU detail...</p>
        </div>
      </div>,
    );
  }

  if (c.error && !data) {
    return wrapPanel(
      <div className="flex h-full flex-col items-center justify-center bg-gray-50 px-6">
        <p className="mb-4 text-sm font-bold text-red-600">{c.error}</p>
        <button onClick={c.handleClose} className="text-sm font-bold text-blue-600 underline">
          Back to SKU Stock
        </button>
      </div>,
    );
  }

  if (!data) return isPanel ? wrapPanel(null) : null;

  return wrapPanel(
    <div className="flex h-full min-h-0 flex-col bg-gray-50">
      <SkuDetailHeader c={c} data={data} />

      <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4">
        {data.productImage && (
          <div className="rounded-xl bg-white border border-gray-200 overflow-hidden">
            <img src={data.productImage} alt={data.productTitle || data.sku} className="w-full h-48 object-contain bg-gray-50" loading="eager" />
          </div>
        )}

        <SkuStockCard c={c} data={data} />
        <SkuLocationCard c={c} data={data} />
        <SkuDetailCards c={c} data={data} />
      </div>

      {/* Footer: deactivate (panel only, active catalog SKUs) */}
      {isPanel && data.catalog?.isActive ? (
        <div className="flex-shrink-0 border-t border-gray-200 bg-white px-4 py-3">
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

      {c.lightboxUrl && <SkuPhotoLightbox url={c.lightboxUrl} onClose={() => c.setLightboxUrl(null)} />}
    </div>,
  );
}
