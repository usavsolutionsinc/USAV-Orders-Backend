'use client';

import { ChevronLeft } from '@/components/Icons';
import { ViewDropdown, type ViewDropdownOption } from '@/components/ui/ViewDropdown';
import {
  sidebarHeaderBandClass,
  sidebarHeaderControlClass,
} from '@/components/layout/header-shell';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Top-level navigation modes in the mobile SKU Stock dashboard.
 *
 * scan    → scanner-first landing (recent scans + FAB)
 * stock   → SKU Stock table (browser below banner)
 * history → SKU History table
 * browse  → full SkuBrowser table (all SKUs)
 * bin_map → bin label printer / bin grid view
 */
export type MobileSkuStockMode = 'scan' | 'stock' | 'history' | 'browse' | 'bin_map';

const MODE_OPTIONS: ReadonlyArray<ViewDropdownOption<MobileSkuStockMode>> = [
  { value: 'scan', label: 'SCAN' },
  { value: 'stock', label: 'SKU STOCK' },
  { value: 'history', label: 'SKU HISTORY' },
  { value: 'browse', label: 'BROWSE SKUS' },
  { value: 'bin_map', label: 'BIN MAP' },
];

interface MobileSkuStockTopBannerProps {
  mode: MobileSkuStockMode;
  onModeChange: (next: MobileSkuStockMode) => void;
  onOpenAppNav: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MobileSkuStockTopBanner({
  mode,
  onModeChange,
  onOpenAppNav,
}: MobileSkuStockTopBannerProps) {
  const headerBandClass = `${sidebarHeaderBandClass} pt-[env(safe-area-inset-top)]`;

  return (
    <div className={headerBandClass}>
      <div className="grid w-full min-h-[44px] grid-cols-[40px_minmax(0,1fr)] items-stretch divide-x divide-gray-400">
        <div className="flex min-h-[44px] items-stretch bg-white">
          <button
            type="button"
            onClick={onOpenAppNav}
            aria-label="Open app navigation"
            className="flex h-full w-full items-center justify-center bg-white text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>
        <div className="relative min-w-0 bg-white">
          <ViewDropdown
            options={MODE_OPTIONS}
            value={mode}
            onChange={onModeChange}
            variant="boxy"
            buttonClassName={`${sidebarHeaderControlClass} !px-2 !py-0.5 !pr-7`}
            optionClassName="text-[10px] font-black tracking-wider"
          />
        </div>
      </div>
    </div>
  );
}
