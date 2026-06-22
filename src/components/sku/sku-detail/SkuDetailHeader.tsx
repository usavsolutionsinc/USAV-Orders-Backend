import { ChevronLeft, Check, Copy, X } from '@/components/Icons';
import { cardTitle, monoValue } from '@/design-system/tokens/typography/presets';
import type { SkuDetailData } from './sku-detail-types';
import type { SkuDetailController } from './useSkuDetailView';

/** Top bar — back/close, title + copyable SKU, and the Ecwid price/stock badge. */
export function SkuDetailHeader({ c, data }: { c: SkuDetailController; data: SkuDetailData }) {
  return (
    <div className="flex-shrink-0 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
      <button
        onClick={c.handleClose}
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
        aria-label={c.isPanel ? 'Close' : 'Back'}
      >
        {c.isPanel ? <X className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
      </button>
      <div className="min-w-0 flex-1">
        <h1 className={`${cardTitle} truncate`}>{data.productTitle || data.sku}</h1>
        <button
          onClick={() => c.handleCopy(data.sku, 'sku')}
          className={`${monoValue} text-caption text-gray-500 hover:text-blue-600 transition-colors flex items-center gap-1`}
        >
          {data.sku}
          {c.copiedField === 'sku' ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      {data.ecwid?.price != null && (
        <div className="text-right">
          <p className="text-lg font-black text-gray-900">${data.ecwid.price.toFixed(2)}</p>
          <p className={`text-micro font-bold uppercase tracking-wider ${data.ecwid.inStock ? 'text-emerald-600' : 'text-red-500'}`}>
            {data.ecwid.inStock ? 'In Stock' : 'Out of Stock'}
          </p>
        </div>
      )}
    </div>
  );
}
