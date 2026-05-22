'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { sidebarHeaderBandClass, sidebarHeaderRowClass } from '@/components/layout/header-shell';
import { SearchBar } from '@/components/ui/SearchBar';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { BARCODE_MODES, type BarcodeMode } from '@/components/barcode/ModeSelector';
import { useBarcodeMode } from '@/hooks/useBarcodeMode';
import { useLabelRecents } from '@/hooks/useLabelRecents';
import { useSkuCatalogSearch, type SkuCatalogItem } from '@/hooks/useSkuCatalogSearch';
import { ChevronDown, Printer, Database, Link2 } from '@/components/Icons';
import { successFeedback } from '@/lib/feedback/confirm';
import { usePairingQueueCount } from '@/components/products/pairing/usePairingQueueCount';
import { PairingQueueList } from '@/components/products/pairing/PairingQueueList';
import type { PairingQueueItem } from '@/components/products/pairing/types';

type View = 'catalog' | 'labels' | 'pairing';
function parseView(raw: string | null): View {
  if (raw === 'catalog') return 'catalog';
  if (raw === 'pairing') return 'pairing';
  return 'labels';
}

/**
 * Sidebar surface for `/products`. Hosts:
 *   - View toggle (Label Printer vs Catalog) — drives `?view=` (labels default)
 *   - Label Printer mode dropdown — drives `?mode=` via useBarcodeMode
 *   - SearchBar — drives `?q=` (consumed by ProductsShell table in catalog
 *     view, and by the in-sidebar Ecwid product list in labels view)
 *   - Ecwid product list (labels view) — clicking a row dispatches `sku:fill`
 *     so MultiSkuSnBarcode auto-fills and starts its print flow
 *
 * Mounted by DashboardSidebar when routeKey === 'products'. The right-pane
 * workspace and this panel both read the same URL searchParams, so no
 * prop-drilling or context is needed.
 */
export function ProductsSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = parseView(searchParams.get('view'));
  const currentQuery = searchParams.get('q') || '';

  const { mode, setMode } = useBarcodeMode();
  const { recents } = useLabelRecents();
  const { total: pairingDebt } = usePairingQueueCount();

  const viewItems = useMemo<HorizontalSliderItem[]>(
    () => [
      { id: 'labels',  label: 'Label Printer', icon: Printer },
      { id: 'catalog', label: 'Catalog',       icon: Database },
      { id: 'pairing', label: 'Pairing',       icon: Link2,
        count: pairingDebt > 0 ? pairingDebt : undefined },
    ],
    [pairingDebt],
  );

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
    (id: string) => updateParams({ view: id === 'labels' ? null : id }),
    [updateParams],
  );

  const isPairing = view === 'pairing';

  const handleProductPick = useCallback((sku: string) => {
    window.dispatchEvent(new CustomEvent('sku:fill', { detail: { sku } }));
  }, []);

  const isLabels = view === 'labels';

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* View toggle — Label Printer leads (default landing surface). */}
      <div className={`${sidebarHeaderBandClass} px-3`}>
        <HorizontalButtonSlider
          items={viewItems}
          value={view}
          onChange={handleViewChange}
          variant="nav"
          aria-label="Products view"
        />
      </div>

      {/* Label-printer mode dropdown — pinned at the top of the labels stack
          above the search bar so the operator can switch flows without
          scrolling past the product list. */}
      {isLabels && (
        <div className="shrink-0 border-b border-gray-100 bg-white px-3 py-2">
          <ModeDropdown mode={mode} onChange={setMode} />
        </div>
      )}

      {/* Search bar — hidden in pairing view; the pairing queue has its own
          inline search wired to its filter, so a second one was redundant. */}
      {!isPairing && (
        <div className={sidebarHeaderRowClass}>
          <SearchBar
            value={searchInput}
            onChange={handleSearchChange}
            onClear={() => handleSearchChange('')}
            placeholder={isLabels ? 'Search SKU, title…' : 'Search products…'}
            variant={isLabels ? 'blue' : 'gray'}
            size="compact"
          />
        </div>
      )}

      {isLabels ? (
        <ProductPickerList
          query={searchInput}
          recents={recents.map((r) => r.sku)}
          onPick={handleProductPick}
        />
      ) : isPairing ? (
        <PairingSidebarQueue />
      ) : (
        // Catalog view: leave the rest of the sidebar empty — the table in
        // the main pane is the primary interaction surface.
        <div className="flex-1" />
      )}
    </div>
  );
}

export default ProductsSidebarPanel;

// ─── Pairing sidebar queue ─────────────────────────────────────────────────

/**
 * The pairing queue list, hosted directly in the sidebar (replaces the
 * standalone left rail in ProductsPairingShell). Selection writes ?sku=
 * so the main pane (ProductHubPanel) picks it up via URL.
 */
function PairingSidebarQueue() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedSku = searchParams.get('sku') || null;

  const handleSelect = useCallback(
    (item: PairingQueueItem) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('view', 'pairing');
      params.set('sku', item.sku);
      router.replace(`/products?${params.toString()}`);
    },
    [router, searchParams],
  );

  return (
    <PairingQueueList
      selectedSku={selectedSku}
      onSelect={handleSelect}
    />
  );
}

// ─── Mode dropdown ──────────────────────────────────────────────────────────

interface ModeDropdownProps {
  mode: BarcodeMode;
  onChange: (next: BarcodeMode) => void;
}

function ModeDropdown({ mode, onChange }: ModeDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = BARCODE_MODES.find((m) => m.id === mode) ?? BARCODE_MODES[0];

  // Click-away closes the menu.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const CurrentIcon = current.Icon;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-gray-300"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
          <CurrentIcon className="h-4 w-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[11px] font-black uppercase tracking-[0.14em] text-gray-900">
            {current.label}
          </span>
          <span className="truncate text-[10px] font-medium text-gray-500">
            {current.description}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
        >
          {BARCODE_MODES.map(({ id, label, description, Icon }) => {
            const isActive = id === mode;
            return (
              <li key={id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    if (id !== mode) {
                      successFeedback();
                      onChange(id);
                    }
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                    isActive ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      isActive ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[11px] font-black uppercase tracking-[0.14em] text-gray-900">
                      {label}
                    </span>
                    <span className="truncate text-[10px] font-medium text-gray-500">
                      {description}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Product picker list ────────────────────────────────────────────────────

interface ProductPickerListProps {
  query: string;
  /** Most-recently-printed SKUs, newest first. Floated to the top when not searching. */
  recents: string[];
  onPick: (sku: string) => void;
}

function ProductPickerList({ query, recents, onPick }: ProductPickerListProps) {
  // Pulls from sku_platform_ids (platform = 'ecwid') via the catalog search
  // API. allowEmpty fetches the top page when the user hasn't typed yet so
  // there's always something to click.
  const { data, isLoading, isError } = useSkuCatalogSearch(query, {
    limit: 50,
    allowEmpty: true,
    searchField: 'ecwid_sku',
  });

  const items = data ?? [];
  const trimmedQuery = query.trim();

  // When idle (no query) we float recents above the alphabetical list so
  // "what I just printed" stays one tap away. With a query, the recents
  // pin makes no sense — results are already ordered by relevance.
  const recentItems = trimmedQuery
    ? []
    : recents
        .map((sku) => items.find((i) => i.sku.toUpperCase() === sku.toUpperCase()))
        .filter((i): i is SkuCatalogItem => !!i);

  const recentSet = new Set(recentItems.map((i) => i.sku.toUpperCase()));
  const restItems = items.filter((i) => !recentSet.has(i.sku.toUpperCase()));

  return (
    <div className="flex-1 overflow-y-auto">
      {isLoading && items.length === 0 ? (
        <div className="px-4 py-6 text-center text-[11px] font-semibold text-gray-400">
          Loading products…
        </div>
      ) : isError ? (
        <div className="px-4 py-6 text-center text-[11px] font-semibold text-red-500">
          Couldn't load products.
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 py-6 text-center text-[11px] font-semibold text-gray-400">
          {trimmedQuery ? 'No matches.' : 'No Ecwid products available.'}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {recentItems.length > 0 && (
            <li className="bg-gray-50 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-gray-500">
              Recent
            </li>
          )}
          {recentItems.map((item) => (
            <ProductRow key={`recent-${item.id}`} item={item} onPick={onPick} />
          ))}
          {recentItems.length > 0 && restItems.length > 0 && (
            <li className="bg-gray-50 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-gray-500">
              All
            </li>
          )}
          {restItems.map((item) => (
            <ProductRow key={item.id} item={item} onPick={onPick} />
          ))}
        </ul>
      )}
    </div>
  );
}

interface ProductRowProps {
  item: SkuCatalogItem;
  onPick: (sku: string) => void;
}

function ProductRow({ item, onPick }: ProductRowProps) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(item.sku)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-blue-50"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-50 ring-1 ring-gray-200">
          {item.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.image_url}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <Printer className="h-4 w-4 text-gray-300" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[12px] font-semibold leading-snug text-gray-900 break-words">
            {item.product_title || item.sku}
          </span>
          <span className="truncate font-mono text-[10px] text-gray-500">{item.sku}</span>
        </span>
      </button>
    </li>
  );
}
