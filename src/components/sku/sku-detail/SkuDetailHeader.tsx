import { ChevronLeft, Check, Copy, X } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { cardTitle, monoValue } from '@/design-system/tokens/typography/presets';
import type { SkuDetailData } from './sku-detail-types';
import type { SkuDetailController } from './useSkuDetailView';

/** Top bar — back/close, title + copyable SKU, and the Ecwid price/stock badge. */
export function SkuDetailHeader({ c, data }: { c: SkuDetailController; data: SkuDetailData }) {
  return (
    <div className="flex-shrink-0 flex items-center gap-3 border-b border-border-soft bg-surface-card px-4 py-3">
      <IconButton
        icon={c.isPanel ? <X className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        ariaLabel={c.isPanel ? 'Close' : 'Back'}
        onClick={c.handleClose}
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-sunken text-text-muted hover:bg-surface-strong"
      />
      <div className="min-w-0 flex-1">
        <h1 className={`${cardTitle} truncate`}>{data.productTitle || data.sku}</h1>
        <button
          onClick={() => c.handleCopy(data.sku, 'sku')}
          className={`ds-raw-button ${monoValue} text-caption text-text-soft hover:text-blue-600 transition-colors flex items-center gap-1`}
        >
          {data.sku}
          {c.copiedField === 'sku' ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      {data.ecwid?.price != null && (
        <div className="text-right">
          <p className="text-lg font-black text-text-default">${data.ecwid.price.toFixed(2)}</p>
          <p className={`text-micro font-bold uppercase tracking-wider ${data.ecwid.inStock ? 'text-emerald-600' : 'text-red-500'}`}>
            {data.ecwid.inStock ? 'In Stock' : 'Out of Stock'}
          </p>
        </div>
      )}
    </div>
  );
}
