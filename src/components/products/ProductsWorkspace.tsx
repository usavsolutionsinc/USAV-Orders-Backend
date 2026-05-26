'use client';

import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ManualLibrary } from '@/components/manuals/ManualLibrary';

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

export function ProductsWorkspace() {
  const searchParams = useSearchParams();
  const view = searchParams.get('view');

  if (view === 'labels') return <MultiSkuSnBarcode layout="horizontal" />;
  if (view === 'pairing') return <ProductsPairingShell />;
  // Manuals (default) + QC both render the PDF viewer in the main pane —
  // selection comes from the sidebar's LibraryBrowser (`?id=`).
  return <ManualLibrary />;
}

export default ProductsWorkspace;
