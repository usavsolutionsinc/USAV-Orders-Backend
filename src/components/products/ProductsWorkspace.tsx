'use client';

import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ManualLibrary } from '@/components/manuals/ManualLibrary';
import { parseLabelsView } from '@/components/sidebar/ProductsSidebarPanel';

// Lazy-load the labels workspace — it pulls in the DataMatrix renderer +
// barcode helpers + sub-components that aren't needed for the default
// Manuals view.
const MultiSkuSnBarcode = dynamic(() => import('@/components/MultiSkuSnBarcode'), {
  ssr: false,
  loading: () => <div className="p-6 text-sm text-gray-400">Loading labels…</div>,
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
  const labelsView = parseLabelsView(searchParams.get('labelsView'));

  if (view === 'labels') {
    // History sub-view will get its own dedicated workspace (unit timeline
    // + pairing context) in the next phase. Until then, the empty-state
    // mirrors the sidebar placeholder so the URL is reachable. Print and
    // Recent both keep the same workspace — Recent's interactions land
    // back in the Print workflow via the existing `sku:fill` event.
    if (labelsView === 'history') return <UnitHistoryPlaceholder />;
    return <MultiSkuSnBarcode layout="horizontal" />;
  }
  if (view === 'pairing') return <ProductsPairingShell />;
  // Manuals (default) + QC both render the PDF viewer in the main pane —
  // selection comes from the sidebar's LibraryBrowser (`?id=`).
  return <ManualLibrary />;
}

function UnitHistoryPlaceholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <p className="text-eyebrow font-black uppercase tracking-[0.18em] text-gray-400">
        Unit history
      </p>
      <p className="mt-3 max-w-[420px] text-sm font-medium text-gray-500">
        Scan a DataMatrix from the sidebar to load a unit's full audit trail —
        every receive, move, allocation, and ship event in one timeline.
      </p>
    </div>
  );
}

export default ProductsWorkspace;
