'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { sidebarHeaderBandClass } from '@/components/layout/header-shell';
import { ViewDropdown } from '@/components/ui/ViewDropdown';
import { SearchBar } from '@/components/ui/SearchBar';
import { FavoritesWorkspaceSection } from '@/components/sidebar/FavoritesWorkspaceSection';
import MultiSkuSnBarcode from '@/components/MultiSkuSnBarcode';
import { parseSkuView, type SkuView } from '@/components/sku/SkuBrowser';
import type { FavoriteSkuRecord } from '@/lib/favorites/sku-favorites';

// ─── Component ──────────────────────────────────────────────────────────────

interface SkuStockSidebarPanelProps {
  /** Hide search bar and view dropdown (used on mobile where the top banner handles those). */
  hideSearch?: boolean;
}

export function SkuStockSidebarPanel({ hideSearch = false }: SkuStockSidebarPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentSearch = searchParams.get('search') || '';
  const [searchInput, setSearchInput] = useState(currentSearch);
  const [activeFilledSku, setActiveFilledSku] = useState('');
  // When navigating to /sku-stock/location/{barcode} the URL has no
  // ?view param — force the dropdown to "Location" anyway so it doesn't
  // flicker back to SKU Stock while the route is bin-scoped.
  const onLocationRoute = Boolean(
    pathname && pathname.startsWith('/sku-stock/location'),
  );
  const view: SkuView = onLocationRoute
    ? 'location'
    : parseSkuView(searchParams.get('view'));

  // Sync external search param changes
  useEffect(() => {
    setSearchInput(currentSearch);
  }, [currentSearch]);

  // Debounced search → URL param
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === currentSearch) return;

    const handle = window.setTimeout(() => {
      const nextParams = new URLSearchParams(searchParams.toString());
      if (trimmed) {
        nextParams.set('search', trimmed);
      } else {
        nextParams.delete('search');
      }
      const qs = nextParams.toString();
      router.replace(qs ? `/sku-stock?${qs}` : '/sku-stock');
    }, 250);

    return () => window.clearTimeout(handle);
  }, [currentSearch, router, searchInput, searchParams]);

  // Track sku:fill events for highlight feedback
  useEffect(() => {
    const handleSkuFill = (event: Event) => {
      const sku = String((event as CustomEvent<{ sku?: string }>).detail?.sku || '').trim().toLowerCase();
      setActiveFilledSku(sku);
    };
    window.addEventListener('sku:fill', handleSkuFill);
    return () => window.removeEventListener('sku:fill', handleSkuFill);
  }, []);

  const updateSearch = (value: string) => {
    const trimmed = value.trim();
    // In Location view, the search bar is a bin-barcode field — route to the
    // dedicated location page instead of fanning out a list query.
    if (view === 'location' && trimmed) {
      router.push(`/sku-stock/location/${encodeURIComponent(trimmed)}`);
      return;
    }
    const nextParams = new URLSearchParams(searchParams.toString());
    if (trimmed) {
      nextParams.set('search', trimmed);
    } else {
      nextParams.delete('search');
    }
    const qs = nextParams.toString();
    router.replace(qs ? `/sku-stock?${qs}` : '/sku-stock');
  };

  const handleUseFavorite = (favorite: FavoriteSkuRecord) => {
    const nextSearchValue = favorite.sku || favorite.label;
    setSearchInput(nextSearchValue);
    updateSearch(nextSearchValue);
  };

  const handleAddFavorite = (favorite: FavoriteSkuRecord) => {
    const sku = String(favorite.sku || '').trim();
    if (!sku) return;
    window.dispatchEvent(new CustomEvent('sku:fill', { detail: { sku } }));
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white">
      {/* View toggle (desktop sidebar only) */}
      {!hideSearch && (
        <div className={sidebarHeaderBandClass}>
          <ViewDropdown
            options={[
              { value: 'sku_stock', label: 'SKU EDIT' },
              { value: 'sku_history', label: 'SKU HISTORY' },
              { value: 'location', label: 'LOCATION' },
            ]}
            value={view}
            onChange={(nextView) => {
              const nextParams = new URLSearchParams(searchParams.toString());
              nextParams.set('view', nextView);
              const qs = nextParams.toString();
              router.replace(qs ? `/sku-stock?${qs}` : '/sku-stock');
            }}
          />
        </div>
      )}

      {/* Search (desktop sidebar only) */}
      {!hideSearch && (
        <div className="border-b border-gray-100 p-4 bg-white">
          <SearchBar
            value={searchInput}
            onChange={setSearchInput}
            onSearch={updateSearch}
            onClear={() => {
              setSearchInput('');
              updateSearch('');
            }}
            placeholder={
              view === 'sku_stock'
                ? 'Search stock, sku, or product title...'
                : view === 'location'
                ? 'Type or scan a bin barcode...'
                : 'Search sku, serial, location, tracking, notes...'
            }
            isSearching={false}
            variant="blue"
          />
        </div>
      )}

      {/* Scrollable content: favorites + barcode tool */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        <div className="p-4">
          <FavoritesWorkspaceSection
            workspaceKey="sku-stock"
            accent="blue"
            title="Favorites"
            description=""
            emptyLabel="No SKU stock favorites yet"
            useLabel="Search SKU"
            inlineRows
            buttonAccent="blue"
            addButtonAccent="green"
            onUseFavorite={handleUseFavorite}
            onAddFavorite={handleAddFavorite}
            isFavoriteAdded={(favorite) =>
              String(favorite.sku || '').trim().toLowerCase() === activeFilledSku
            }
          />
        </div>
        <MultiSkuSnBarcode />
      </div>

      {/* Footer */}
      <footer className="p-4 border-t border-gray-100 opacity-30 mt-auto text-center">
        <p className="text-[7px] font-mono uppercase tracking-[0.2em] text-gray-500">USAV GEN</p>
      </footer>
    </div>
  );
}
