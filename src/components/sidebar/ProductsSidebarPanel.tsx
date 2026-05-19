'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { sidebarHeaderBandClass, sidebarHeaderRowClass } from '@/components/layout/header-shell';
import { SearchBar } from '@/components/ui/SearchBar';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { ModeSelector, type BarcodeMode } from '@/components/barcode/ModeSelector';
import { RecentsStrip } from '@/components/barcode/RecentsStrip';
import { useBarcodeMode } from '@/hooks/useBarcodeMode';
import { useLabelRecents } from '@/hooks/useLabelRecents';
import { sectionLabel } from '@/design-system/tokens/typography/presets';

const VIEW_ITEMS: HorizontalSliderItem[] = [
  { id: 'catalog', label: 'Catalog', tone: 'zinc' },
  { id: 'labels',  label: 'Label Printer', tone: 'blue' },
];

type View = 'catalog' | 'labels';
function parseView(raw: string | null): View {
  return raw === 'labels' ? 'labels' : 'catalog';
}

/**
 * Sidebar surface for `/products`. Hosts:
 *   - View toggle (Catalog vs Label Printer) — drives `?view=`
 *   - SearchBar — drives `?q=` (consumed by ProductsShell table)
 *   - Mode pills (Print / Reprint / SN-to-SKU / Move Location) — drives `?mode=`
 *     via useBarcodeMode, picked up by MultiSkuSnBarcode in the main pane
 *   - Recents strip — dispatches `sku:fill` so MultiSkuSnBarcode re-fills
 *
 * Mounted by DashboardSidebar when routeKey === 'products'. The right-pane
 * workspace and this panel both read the same URL searchParams so they
 * always agree, no prop-drilling or context.
 */
export function ProductsSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = parseView(searchParams.get('view'));
  const currentQuery = searchParams.get('q') || '';

  const { mode, setMode } = useBarcodeMode();
  const { recents, clear: clearRecents } = useLabelRecents();

  const [searchInput, setSearchInput] = useState(currentQuery);
  useEffect(() => {
    // Sync external URL changes back into the input (e.g. browser back).
    setSearchInput(currentQuery);
  }, [currentQuery]);

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, val] of Object.entries(updates)) {
        if (val === null) params.delete(key);
        else params.set(key, val);
      }
      const qs = params.toString();
      router.replace(qs ? `/products?${qs}` : '/products');
    },
    [router, searchParams],
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      updateParams({ q: value.trim() || null });
    },
    [updateParams],
  );

  const handleViewChange = useCallback(
    (id: string) => updateParams({ view: id === 'catalog' ? null : id }),
    [updateParams],
  );

  const handleModeChange = useCallback(
    (next: BarcodeMode) => setMode(next),
    [setMode],
  );

  const handleRecentPick = useCallback((sku: string) => {
    window.dispatchEvent(new CustomEvent('sku:fill', { detail: { sku } }));
  }, []);

  const isLabels = view === 'labels';

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className={`${sidebarHeaderBandClass} ${sidebarHeaderRowClass}`}>
        <SearchBar
          value={searchInput}
          onChange={handleSearchChange}
          onClear={() => handleSearchChange('')}
          placeholder={isLabels ? 'Scan a SKU…' : 'Search products…'}
          variant={isLabels ? 'blue' : 'gray'}
          size="compact"
        />
      </div>

      {/* View toggle — Catalog vs Label Printer */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-3 py-1.5">
        <HorizontalButtonSlider
          items={VIEW_ITEMS}
          value={view}
          onChange={handleViewChange}
          variant="fba"
          size="md"
          aria-label="Products view"
        />
      </div>

      {/* Label-printer-only controls below the view toggle */}
      {isLabels && (
        <>
          <div className="shrink-0 border-b border-gray-100 bg-white px-3 py-3 space-y-2">
            <p className={`${sectionLabel} px-1`}>Mode</p>
            <ModeSelector mode={mode} onModeChange={handleModeChange} orientation="vertical" />
          </div>

          {recents.length > 0 && (
            <div className="shrink-0 border-b border-gray-100 bg-white">
              <RecentsStrip
                recents={recents}
                onPick={handleRecentPick}
                onClear={clearRecents}
              />
            </div>
          )}

          <div className="flex flex-1 items-end px-3 pb-3 pt-2">
            <p className="text-[10px] font-medium text-gray-400">
              Tip · ⌘P prints the current label when the workspace preview is ready.
            </p>
          </div>
        </>
      )}

      {/* Catalog mode: leave the rest of the sidebar empty — the table in
          the main pane is the primary interaction surface. */}
      {!isLabels && <div className="flex-1" />}
    </div>
  );
}

export default ProductsSidebarPanel;
