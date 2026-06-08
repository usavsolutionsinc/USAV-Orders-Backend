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

// Lazy-load the unit detail viewer — mounts for both Recent and History
// sub-views (read-only unit detail: linkage header, identity, location,
// timeline). Pulls in the SKU-graph + popover bundle, none of which the
// default Manuals view needs.
const UnitDetailWorkspace = dynamic(
  () => import('@/components/labels/unit-detail/UnitDetailWorkspace').then((m) => m.UnitDetailWorkspace),
  {
    ssr: false,
    loading: () => <div className="p-6 text-sm text-gray-400">Loading unit detail…</div>,
  },
);

// Lazy-load the QC checklist workspace — only mounts when view=qc.
const QcChecklistWorkspace = dynamic(
  () => import('./QcChecklistWorkspace').then((m) => m.QcChecklistWorkspace),
  {
    ssr: false,
    loading: () => <div className="p-6 text-sm text-gray-400">Loading QC checklist…</div>,
  },
);

export function ProductsWorkspace() {
  const searchParams = useSearchParams();
  const view = searchParams.get('view');
  const labelsView = parseLabelsView(searchParams.get('labelsView'));

  if (view === 'labels') {
    // Printing only happens on the Products (`print`) sub-view. Recent and
    // History both render the read-only unit detail workspace, fed by
    // `?historyId=` — Recent's row click selects a printed unit, History's
    // scan/paste resolves one. Neither shows the label-printing component.
    if (labelsView === 'print') return <MultiSkuSnBarcode layout="horizontal" />;
    return <UnitDetailWorkspace />;
  }
  if (view === 'pairing') return <ProductsPairingShell />;
  // QC view: right pane shows the selected SKU's QC checklist (selection comes
  // from the sidebar's QcProductPicker via `?skuId=`).
  if (view === 'qc') return <QcChecklistWorkspace />;
  // Manuals (default) renders the PDF viewer in the main pane — selection
  // comes from the sidebar's LibraryBrowser (`?id=`).
  return <ManualLibrary />;
}
