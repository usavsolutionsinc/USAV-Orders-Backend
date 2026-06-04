'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { sidebarHeaderPillRowClass, SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { useMasterNavEnabled } from '@/components/sidebar/master-nav';
import { BARCODE_MODES, type BarcodeMode } from '@/components/barcode/ModeSelector';
import { useBarcodeMode } from '@/hooks/useBarcodeMode';
import { useLabelRecents } from '@/hooks/useLabelRecents';
import { useSkuCatalogSearch, type SkuCatalogItem } from '@/hooks/useSkuCatalogSearch';
import { detectSkuCatalogSearchField } from '@/lib/detectSearchField';
import { ChevronDown, Printer, FileText, Link2, Check, Clock, History, Package } from '@/components/Icons';
import { successFeedback } from '@/lib/feedback/confirm';
import { PairingQueueList } from '@/components/products/pairing/PairingQueueList';
import type { PairingQueueItem, PairingSort } from '@/components/products/pairing/types';
import { LibraryBrowser } from '@/components/manuals/LibraryBrowser';
import { RecentlyPrintedList } from '@/components/labels/RecentlyPrintedList';
import { UnitHistoryFinder } from '@/components/labels/UnitHistoryFinder';

const PAIRING_SORT_ITEMS: HorizontalSliderItem[] = [
  { id: 'volume',     label: 'Most ordered' },
  { id: 'confidence', label: 'Top confidence' },
  { id: 'count',      label: 'Most suggestions' },
  { id: 'title',      label: 'Alphabetical' },
];

function parsePairingSort(raw: string | null): PairingSort {
  if (raw === 'confidence' || raw === 'count' || raw === 'title') return raw;
  return 'volume';
}

type View = 'manuals' | 'labels' | 'pairing' | 'qc';
function parseView(raw: string | null): View {
  if (raw === 'labels') return 'labels';
  if (raw === 'pairing') return 'pairing';
  if (raw === 'qc') return 'qc';
  // Manuals is the default landing view (folds in the retired /manuals route).
  return 'manuals';
}

// Sub-tabs under the Labels view. `print` is the default and stays out of
// the URL to keep deep links clean; `recent` and `history` are explicit.
export type LabelsSubView = 'print' | 'recent' | 'history';
export function parseLabelsView(raw: string | null): LabelsSubView {
  if (raw === 'recent') return 'recent';
  if (raw === 'history') return 'history';
  return 'print';
}

const LABELS_SUB_VIEW_ITEMS: HorizontalSliderItem[] = [
  { id: 'print',   label: 'Products', icon: Package },
  { id: 'recent',  label: 'Recent',   icon: Clock },
  { id: 'history', label: 'History',  icon: History },
];

// Light scaffolding for the Recent and History sub-views while their data
// paths land in follow-up phases. Defined at module-top (before the main
// component) so the function declaration is reliably available when the
// JSX above evaluates — Turbopack's HMR has been seen to hand back stale
// builds where a function declaration further down the file is missing
// from the hoisted set, producing a ReferenceError at use sites.
function LabelsSubViewPlaceholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <p className="text-eyebrow font-black uppercase tracking-[0.18em] text-gray-400">
        {title}
      </p>
      <p className="mt-3 max-w-[260px] text-caption font-medium text-gray-500">{body}</p>
    </div>
  );
}

/**
 * Sidebar surface for `/products`. Hosts:
 *   - View toggle — Manuals (default) · Labels · Pairing · QC. Writes `?view=`.
 *   - Manuals view (default): renders <SkuCatalogSidebar> which owns its own
 *     search + sort + mode pills + selected-product accordion sections.
 *   - Labels view: second pill row (Print · Recent · History) writes
 *     `?labelsView=`. Print is the default sub-view and shows the mode
 *     dropdown + SearchBar + Ecwid product picker list; picking a row
 *     dispatches `sku:fill` for the MultiSkuSnBarcode workspace. Recent
 *     and History sub-views host their own bodies (no shared search bar).
 *   - Pairing view: PairingQueueList; selection writes ?sku=.
 *
 * Mounted by DashboardSidebar when routeKey === 'products'. The right-pane
 * workspace and this panel both read the same URL searchParams, so no
 * prop-drilling or context is needed.
 */
export function ProductsSidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const masterNavEnabled = useMasterNavEnabled();
  const view = parseView(searchParams.get('view'));
  const labelsView = parseLabelsView(searchParams.get('labelsView'));
  const currentQuery = searchParams.get('q') || '';
  const pairingSort = parsePairingSort(searchParams.get('sort'));

  const { mode, setMode } = useBarcodeMode();
  const { recents } = useLabelRecents();

  const viewItems = useMemo<HorizontalSliderItem[]>(
    () => [
      { id: 'manuals', label: 'Manuals',       icon: FileText },
      { id: 'labels',  label: 'Labels', icon: Printer },
      { id: 'pairing', label: 'Pairing',       icon: Link2 },
      { id: 'qc',      label: 'QC Checklist',  icon: Check },
    ],
    [],
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
    // Manuals is the default — drop the param when selected so the URL stays clean.
    (id: string) => updateParams({ view: id === 'manuals' ? null : id }),
    [updateParams],
  );

  const handlePairingSortChange = useCallback(
    // 'volume' is the default — drop the param when selected so the URL stays clean.
    (id: string) => updateParams({ sort: id === 'volume' ? null : id }),
    [updateParams],
  );

  const handleLabelsSubViewChange = useCallback(
    // 'print' is the default — drop the param when selected so the URL stays clean.
    (id: string) => updateParams({ labelsView: id === 'print' ? null : id }),
    [updateParams],
  );

  const handleProductPick = useCallback((sku: string) => {
    window.dispatchEvent(new CustomEvent('sku:fill', { detail: { sku } }));
  }, []);

  const isManuals = view === 'manuals';
  const isLabels = view === 'labels';
  const isPairing = view === 'pairing';
  // Labels → History sub-view: the top search bar doubles as the unit-history
  // scan/paste input (Enter dispatches a lookup the History list resolves).
  const isHistory = isLabels && labelsView === 'history';

  // Manuals view = the file-tree library browser (sidebar) + PDF viewer
  // (main pane). QC delegates to the main pane. Labels/Pairing have their
  // own sidebar bodies below.
  return (
    <SidebarShell
      className="bg-white"
      headerAbove={
        !masterNavEnabled ? (
          <div className={sidebarHeaderPillRowClass}>
            <HorizontalButtonSlider
              items={viewItems}
              value={view}
              onChange={handleViewChange}
              variant="nav"
              dense
              className="w-full"
              aria-label="Products view"
            />
          </div>
        ) : null
      }
      /* Search bar — always mounted so it stays in position across all sub-views */
      search={{
        value: searchInput,
        onChange: isHistory ? setSearchInput : handleSearchChange,
        onSearch: isHistory
          ? (raw) => {
              const value = raw.trim();
              if (value) {
                window.dispatchEvent(
                  new CustomEvent('unit-history:lookup', { detail: { raw: value } }),
                );
              }
              setSearchInput('');
            }
          : undefined,
        onClear: () => (isHistory ? setSearchInput('') : handleSearchChange('')),
        placeholder: isHistory
          ? 'Scan or paste a DataMatrix…'
          : isLabels
            ? 'Search SKU, title…'
            : isPairing
              ? 'Search pairing queue…'
              : isManuals
                ? 'Fuzzy search folders & manuals…'
                : 'Search products…',
        variant: isLabels ? 'blue' : 'gray',
      }}
      headerRows={[
        // Labels sub-tab row — Print / Recent / History.
        isLabels ? (
          <HorizontalButtonSlider
            items={LABELS_SUB_VIEW_ITEMS}
            value={labelsView}
            onChange={handleLabelsSubViewChange}
            variant="nav"
            dense
            className="w-full"
            aria-label="Labels sub-view"
          />
        ) : null,
        // Pairing sort pills — second row for the Pairing view.
        isPairing ? (
          <HorizontalButtonSlider
            items={PAIRING_SORT_ITEMS}
            value={pairingSort}
            onChange={handlePairingSortChange}
            variant="nav"
            dense
            className="w-full"
            aria-label="Pairing queue sort"
          />
        ) : null,
      ]}
      headerBelow={
        // Label-printer mode dropdown — only shown on the Print sub-view.
        isLabels && labelsView === 'print' ? (
          <div className={`shrink-0 border-b border-gray-100 bg-white ${SIDEBAR_GUTTER} py-2`}>
            <ModeDropdown mode={mode} onChange={setMode} />
          </div>
        ) : null
      }
      bodyClassName="flex flex-col overflow-hidden p-0"
    >
      {isLabels ? (
        labelsView === 'recent' ? (
          <RecentlyPrintedList onPick={handleProductPick} />
        ) : labelsView === 'history' ? (
          <UnitHistoryFinder />
        ) : (
          <ProductPickerList
            query={searchInput}
            recents={recents.map((r) => r.sku)}
            onPick={handleProductPick}
          />
        )
      ) : isPairing ? (
        <PairingSidebarQueue query={searchInput} sort={pairingSort} />
      ) : isManuals ? (
        <LibraryBrowser query={searchInput} basePath="/products" />
      ) : null}
    </SidebarShell>
  );
}

export default ProductsSidebarPanel;

// ─── Pairing sidebar queue ─────────────────────────────────────────────────

/**
 * The pairing queue list, hosted directly in the sidebar (replaces the
 * standalone left rail in ProductsPairingShell). Selection writes ?sku=
 * so the main pane (ProductHubPanel) picks it up via URL. Search comes in
 * from the shared sidebar SearchBar (`?q=`).
 */
function PairingSidebarQueue({ query, sort }: { query: string; sort: PairingSort }) {
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
      query={query}
      sort={sort}
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
        className={`flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-gray-300 ${
          open ? 'rounded-b-none border-b-0' : ''
        }`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
          <CurrentIcon className="h-4 w-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-caption font-black uppercase tracking-[0.14em] text-gray-900">
            {current.label}
          </span>
          <span className="truncate text-micro font-medium text-gray-500">
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
          className="absolute left-0 right-0 top-full z-20 overflow-hidden rounded-b-xl rounded-t-none border border-gray-200 border-t-0 bg-white shadow-lg -mt-px"
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
                    <span className="text-caption font-black uppercase tracking-[0.14em] text-gray-900">
                      {label}
                    </span>
                    <span className="truncate text-micro font-medium text-gray-500">
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
  // there's always something to click. searchField switches between
  // platform_sku and display_name based on the shape of the query — typing a
  // product title like "bose speaker" now matches by name instead of failing
  // silently against the SKU column.
  const searchField = detectSkuCatalogSearchField(query);
  const { data, isLoading, isError } = useSkuCatalogSearch(query, {
    limit: 50,
    allowEmpty: true,
    searchField,
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
        <div className="px-4 py-6 text-center text-caption font-semibold text-gray-400">
          Loading products…
        </div>
      ) : isError ? (
        <div className="px-4 py-6 text-center text-caption font-semibold text-red-500">
          Couldn't load products.
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 py-6 text-center text-caption font-semibold text-gray-400">
          {trimmedQuery ? 'No matches.' : 'No Ecwid products available.'}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {recentItems.length > 0 && (
            <li className={`bg-gray-50 ${SIDEBAR_GUTTER} py-1.5 text-eyebrow font-black uppercase tracking-[0.18em] text-gray-500`}>
              Recent
            </li>
          )}
          {recentItems.map((item) => (
            <ProductRow key={`recent-${item.id}`} item={item} onPick={onPick} />
          ))}
          {recentItems.length > 0 && restItems.length > 0 && (
            <li className={`bg-gray-50 ${SIDEBAR_GUTTER} py-1.5 text-eyebrow font-black uppercase tracking-[0.18em] text-gray-500`}>
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
        className={`flex w-full items-center gap-3 ${SIDEBAR_GUTTER} py-2 text-left transition-colors hover:bg-blue-50`}
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
          <span className="text-label font-semibold leading-snug text-gray-900 break-words">
            {item.product_title || item.sku}
          </span>
          <span className="truncate font-mono text-micro text-gray-500">{item.sku}</span>
        </span>
      </button>
    </li>
  );
}
