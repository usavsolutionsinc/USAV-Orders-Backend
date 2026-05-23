'use client';

import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ProductsShell } from './ProductsShell';
import { ManualsTables } from '@/components/manuals/ManualsTables';

// Lazy-load the label printer — it pulls in the QR library + barcode helpers
// + sub-components that aren't needed for the default Manuals view.
const MultiSkuSnBarcode = dynamic(() => import('@/components/MultiSkuSnBarcode'), {
  ssr: false,
  loading: () => <div className="p-6 text-sm text-gray-400">Loading label printer…</div>,
});

// Lazy-load the pairing shell — pulls in the Product Hub graph + suggestion
// fetcher, none of which the default Manuals view needs.
const ProductsPairingShell = dynamic(
  () => import('./pairing/ProductsPairingShell').then((m) => m.ProductsPairingShell),
  {
    ssr: false,
    loading: () => <div className="p-6 text-sm text-gray-400">Loading pairing workspace…</div>,
  },
);

/**
 * `/products` main-pane router. Reads `?view=` from the URL:
 *   - default / view=manuals → SKU catalog + manuals/QC editing (folded in
 *     from the retired `/manuals` route)
 *   - `view=labels`  → SKU label printer workspace
 *   - `view=catalog` → product catalog table (search, filter, paginate)
 *   - `view=pairing` → Product Hub pairing workspace (kept for deep links)
 *
 * The sidebar (ProductsSidebarPanel) writes `?view=`, so toggling is
 * URL-driven and deep-linkable. Manuals is the landing experience now that
 * the manuals workspace lives under /products.
 */
export function ProductsWorkspace() {
  const searchParams = useSearchParams();
  const view = searchParams.get('view');

  if (view === 'labels') return <MultiSkuSnBarcode layout="horizontal" />;
  if (view === 'catalog') return <ProductsShell />;
  if (view === 'pairing') return <ProductsPairingShell />;
  return <ManualsTables basePath="/products" />;
}

export default ProductsWorkspace;
