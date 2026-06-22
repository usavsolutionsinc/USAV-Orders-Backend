'use client';

import { useMultiSkuBarcode } from './barcode/multi-sku/useMultiSkuBarcode';
import { MultiSkuBarcodeWorkspace } from './barcode/multi-sku/MultiSkuBarcodeWorkspace';
import { MultiSkuBarcodeWizard } from './barcode/multi-sku/MultiSkuBarcodeWizard';

interface MultiSkuSnBarcodeProps {
  /**
   * `vertical` — narrow-column wizard (sidebar / mobile). Steps reveal one at a
   * time, inactive steps dim, parent auto-scrolls to the new step.
   * `horizontal` — desktop workspace (right pane). Inputs and live preview sit
   * side-by-side; all panels stay visible at full opacity.
   */
  layout?: 'vertical' | 'horizontal';
}

/**
 * Unit-label workspace: scan a SKU, capture serials, and print / log / reprint
 * products labels. A thin composition layer — all state and the three issue
 * paths live in {@link useMultiSkuBarcode}; the two layouts are presentational.
 */
export default function MultiSkuSnBarcode({ layout = 'vertical' }: MultiSkuSnBarcodeProps = {}) {
  const b = useMultiSkuBarcode(layout);
  return b.isHorizontal ? <MultiSkuBarcodeWorkspace b={b} /> : <MultiSkuBarcodeWizard b={b} />;
}
