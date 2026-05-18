'use client';

import MultiSkuSnBarcode from '@/components/MultiSkuSnBarcode';

/**
 * Right-pane workspace for /sku-stock. Hosts the multi-SKU + serial label
 * composer in its desktop horizontal layout: inputs on the left, live label
 * preview on the right. The sidebar owns search + the result list and feeds
 * this surface via the `sku:fill` window event.
 */
export function SkuStockWorkspace() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white">
      <MultiSkuSnBarcode layout="horizontal" />
    </div>
  );
}

export default SkuStockWorkspace;
