'use client';

import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ProductsShell } from './ProductsShell';

// Lazy-load the label printer — it pulls in the QR library + barcode helpers
// + sub-components that aren't needed for the default catalog view.
const MultiSkuSnBarcode = dynamic(() => import('@/components/MultiSkuSnBarcode'), {
  ssr: false,
  loading: () => <div className="p-6 text-sm text-gray-400">Loading label printer…</div>,
});

/**
 * `/products` main-pane router. Reads `?view=` from the URL:
 *   - `view=labels` → SKU label printer workspace (QR-only)
 *   - default      → product catalog table (search, filter, paginate)
 *
 * The sidebar (ProductsSidebarPanel) writes `?view=`, so toggling is
 * URL-driven and deep-linkable.
 */
export function ProductsWorkspace() {
  const searchParams = useSearchParams();
  const view = searchParams.get('view');

  if (view === 'labels') {
    return <MultiSkuSnBarcode layout="horizontal" />;
  }
  return <ProductsShell />;
}

export default ProductsWorkspace;
