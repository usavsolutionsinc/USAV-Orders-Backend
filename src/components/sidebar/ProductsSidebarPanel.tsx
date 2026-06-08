'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { sidebarHeaderPillRowClass, SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import { SidebarShell } from '@/components/layout/SidebarShell';
import { HorizontalButtonSlider, type HorizontalSliderItem } from '@/components/ui/HorizontalButtonSlider';
import { useMasterNavEnabled } from '@/components/sidebar/master-nav';
import { useLabelRecents } from '@/hooks/useLabelRecents';
import { useSkuCatalogSearch, type SkuCatalogItem } from '@/hooks/useSkuCatalogSearch';
import { Printer, FileText, Link2, Check, Clock, History, Package, ShoppingCart, Star, Sparkles, List } from '@/components/Icons';
import { PairingQueueList } from '@/components/products/pairing/PairingQueueList';
import { PairingUnmatchedSection } from '@/components/products/pairing/PairingUnmatchedSection';
import { AddOrPairSkuModal } from '@/components/products/pairing/AddOrPairSkuModal';
import type { PairingQueueItem, PairingSort, UnmappedPlatformId } from '@/components/products/pairing/types';
import { LibraryBrowser } from '@/components/manuals/LibraryBrowser';
import { RecentlyPrintedList, recentLookupKey } from '@/components/labels/RecentlyPrintedList';
import type { LabelPrintFeedItem } from '@/hooks/useLabelPrintFeed';
import { UnitHistoryFinder } from '@/components/labels/UnitHistoryFinder';

const PAIRING_SORT_ITEMS: HorizontalSliderItem[] = [
  { id: 'volume',     label: 'Ordered',      icon: ShoppingCart },
  { id: 'confidence', label: 'Confidence',   icon: Star },
  { id: 'count',      label: 'Suggestions',  icon: Sparkles },
  { id: 'title',      label: 'A-Z', icon: List },
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
 *     `?labelsView=`. Print is the default sub-view and shows the SearchBar
 *     + Zoho product picker list; picking a row dispatches `sku:fill` for
 *     the MultiSkuSnBarcode workspace (which now owns the print/log/reprint
 *     mode switcher at the top of its display). Recent and History
 *     sub-views host their own bodies (no shared search bar).
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
    // Clear any selected unit (`historyId`) so each sub-tab starts at its own
    // prompt/empty state instead of carrying over a stale detail selection.
    (id: string) => updateParams({ labelsView: id === 'print' ? null : id, historyId: null }),
    [updateParams],
  );

  const handleProductPick = useCallback((sku: string) => {
    window.dispatchEvent(new CustomEvent('sku:fill', { detail: { sku } }));
  }, []);

  // Recent row → select the printed unit; the main pane (UnitHistoryWorkspace)
  // reads `?historyId=` and loads its full detail. No printing happens here.
  const handleRecentSelect = useCallback(
    (item: LabelPrintFeedItem) => {
      const key = recentLookupKey(item);
      if (key) updateParams({ historyId: key });
    },
    [updateParams],
  );

  const isManuals = view === 'manuals';
  const isLabels = view === 'labels';
  const isPairing = view === 'pairing';
  const isQc = view === 'qc';
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
              ? 'Search SKU, title, or any platform ID…'
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
      bodyClassName="flex flex-col overflow-hidden p-0"
    >
      {isLabels ? (
        labelsView === 'recent' ? (
          <RecentlyPrintedList
            onSelect={handleRecentSelect}
            selectedKey={searchParams.get('historyId')}
          />
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
      ) : isQc ? (
        <QcSidebarPicker query={searchInput} />
      ) : isManuals ? (
        <LibraryBrowser query={searchInput} basePath="/products" />
      ) : null}
    </SidebarShell>
  );
}


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

  // Add/pair modal state — opened from the "not in the queue" section for an
  // unmapped identifier (`pending` set) or to create a brand-new Zoho SKU.
  const [modalOpen, setModalOpen] = useState(false);
  const [pending, setPending] = useState<UnmappedPlatformId | null>(null);

  const openSku = useCallback(
    (sku: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('view', 'pairing');
      params.set('sku', sku);
      router.replace(`/products?${params.toString()}`);
    },
    [router, searchParams],
  );

  const handleSelect = useCallback((item: PairingQueueItem) => openSku(item.sku), [openSku]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PairingUnmatchedSection
        query={query}
        onPairIdentifier={(id) => { setPending(id); setModalOpen(true); }}
        onAddSku={() => { setPending(null); setModalOpen(true); }}
      />

      <div className="min-h-0 flex-1">
        <PairingQueueList
          query={query}
          sort={sort}
          selectedSku={selectedSku}
          onSelect={handleSelect}
        />
      </div>

      <AddOrPairSkuModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        query={query}
        pending={pending}
        onDone={(sku) => { setModalOpen(false); openSku(sku); }}
      />
    </div>
  );
}

// ─── QC sidebar product picker ────────────────────────────────────────────

/**
 * Product list for the QC Checklist view. Searches the SKU catalog and, on
 * select, writes `?view=qc&skuId=<catalogId>` so the main pane
 * (QcChecklistWorkspace) loads that SKU's checklist. The selected row stays
 * highlighted. Empty query fetches the top page so there's always a list.
 */
function QcSidebarPicker({ query }: { query: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedSkuId = searchParams.get('skuId');

  // hasQc restricts the list to SKUs that actually have checklist items linked
  // — searches sku + title server-side, so searchField is left at its default.
  const { data, isLoading, isError } = useSkuCatalogSearch(query, {
    limit: 50,
    allowEmpty: true,
    hasQc: true,
  });

  const items = data ?? [];
  const trimmedQuery = query.trim();

  const handleSelect = useCallback(
    (item: SkuCatalogItem) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('view', 'qc');
      params.set('skuId', String(item.id));
      router.replace(`/products?${params.toString()}`);
    },
    [router, searchParams],
  );

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
          {trimmedQuery ? 'No matches with a QC checklist.' : 'No products have a QC checklist yet.'}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((item) => {
            const isSelected = selectedSkuId === String(item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(item)}
                  aria-current={isSelected}
                  className={`flex w-full items-center gap-3 ${SIDEBAR_GUTTER} py-2 text-left transition-colors ${
                    isSelected ? 'bg-blue-50' : 'hover:bg-blue-50'
                  }`}
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
                      <Package className="h-4 w-4 text-gray-300" />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={`text-label font-semibold leading-snug break-words ${
                        isSelected ? 'text-blue-700' : 'text-gray-900'
                      }`}
                    >
                      {item.product_title || item.sku}
                    </span>
                    <span className="truncate font-mono text-micro text-gray-500">{item.sku}</span>
                  </span>
                  {isSelected && <Check className="h-4 w-4 shrink-0 text-blue-600" />}
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
  // Sources from the Zoho `items` mirror (canonical Zoho SKU + Zoho name) via
  // the catalog search API's `zoho_catalog` field — the Zoho product display is
  // the source of truth. NOT `sku_catalog`/`sku_stock`, which use an independent
  // SKU numbering that collides with Zoho SKUs on the same string (e.g. SKU
  // 00016 is a different product in each table). That single query matches on
  // Zoho SKU OR name, so no per-shape field detection is needed. allowEmpty
  // fetches the top page when the user hasn't typed yet so there's always
  // something to click.
  const { data, isLoading, isError } = useSkuCatalogSearch(query, {
    limit: 50,
    allowEmpty: true,
    searchField: 'zoho_catalog',
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
          {trimmedQuery ? 'No matches.' : 'No products available.'}
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
