import { ExternalLink } from '@/components/Icons';
import { DetailsPanelRow } from '@/design-system/components/DetailsPanelRow';
import { PhotoGallery } from '@/components/shipped/PhotoGallery';
import type { PrepackedSkuInfo } from './types';

export function PrepackedSkuRow({ sku }: { sku: PrepackedSkuInfo }) {
  const hasPhotos = Array.isArray(sku.photos) && sku.photos.length > 0;
  const skuBrowserUrl = `/inventory?sku=${encodeURIComponent(sku.staticSku)}`;

  return (
    <DetailsPanelRow
      label="From Prepacked SKU"
      actions={
        <button
          type="button"
          onClick={() => {
            window.open(skuBrowserUrl, '_blank', 'noopener,noreferrer');
          }}
          className="text-gray-400 transition-colors hover:text-blue-700"
          aria-label="Open SKU table view"
          title="Open SKU table view"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      }
    >
      <div className="space-y-1.5">
        <p className="text-sm font-bold text-black font-mono">{sku.staticSku}</p>
        {sku.productTitle ? (
          <p className="text-micro font-semibold text-gray-500 truncate">{sku.productTitle}</p>
        ) : null}
        {hasPhotos && (
          <PhotoGallery
            photos={sku.photos!}
            orderId={sku.staticSku}
            compact
          />
        )}
      </div>
    </DetailsPanelRow>
  );
}
