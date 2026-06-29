import { ExternalLink } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
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
        <HoverTooltip label="Open SKU table view" asChild>
          <IconButton
            type="button"
            onClick={() => {
              window.open(skuBrowserUrl, '_blank', 'noopener,noreferrer');
            }}
            tone="accent"
            ariaLabel="Open SKU table view"
            icon={<ExternalLink className="h-3.5 w-3.5" />}
          />
        </HoverTooltip>
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
