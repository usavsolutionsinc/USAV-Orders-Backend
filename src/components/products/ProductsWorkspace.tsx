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

// Lazy-load the pairing shell — pulls in the Product Hub graph + suggestion
// fetcher, none of which the default Labels view needs.
const ProductsPairingShell = dynamic(
  () => import('./pairing/ProductsPairingShell').then((m) => m.ProductsPairingShell),
  {
    ssr: false,
    loading: () => <div className="p-6 text-sm text-gray-400">Loading pairing workspace…</div>,
  },
);

/**
 * `/products` main-pane router. Reads `?view=` from the URL:
 *   - `view=catalog` → product catalog table (search, filter, paginate)
 *   - `view=pairing` → Product Hub pairing workspace
 *   - default        → SKU label printer workspace (QR-only)
 *
 * The sidebar (ProductsSidebarPanel) writes `?view=`, so toggling is
 * URL-driven and deep-linkable. Labels is the landing experience because
 * the warehouse floor uses /products primarily to print SKU labels.
 */
export function ProductsWorkspace() {
  const searchParams = useSearchParams();
  const view = searchParams.get('view');

  if (view === 'catalog') return <ProductsShell />;
  if (view === 'pairing') return <ProductsPairingShell />;
  return <MultiSkuSnBarcode layout="horizontal" />;
}

export default ProductsWorkspace;
