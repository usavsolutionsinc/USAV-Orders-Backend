'use client';

/**
 * Warehouse sidebar panel.
 *
 * Mounted on /warehouse. The dashboard chrome owns the title. This panel
 * renders:
 *   - The SKU/bin finder (always visible)
 *   - Pills with counts: Labels · Rooms · Bins · Map
 *   - Tab-specific body: a small contextual hint per tab. Every workspace
 *     (rooms board, location label printer, bins table, warehouse map) lives in
 *     the main area via WarehouseShell so it can use the full content width.
 */

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { sidebarHeaderPillRowClass, SIDEBAR_GUTTER } from '@/components/layout/header-shell';
import {
  HorizontalButtonSlider,
  type HorizontalSliderItem,
} from '@/components/ui/HorizontalButtonSlider';
import { LayoutDashboard, Box, Printer, MapPin, Layers, Database, Package } from '@/components/Icons';
import { useMasterNavEnabled } from '@/components/sidebar/master-nav';
import { useLocations } from '@/hooks/useLocations';
import { useWarehouseSkuSearch, looksLikeBinBarcode } from '@/hooks/useWarehouseSkuSearch';
import { MapLegend, type MapViewMode } from '@/components/warehouse/WarehouseMap';
import { RoomsSidebarList } from '@/components/warehouse/RoomsSidebarList';
import { WarehouseSkuSearchResults } from '@/components/warehouse/WarehouseSkuSearchResults';
import { BinLabelPrinter } from '@/components/barcode/BinLabelPrinter';
import { RackLabelPrinter } from '@/components/barcode/RackLabelPrinter';
import { useAuth } from '@/contexts/AuthContext';
import { RoomFinderProvider, useRoomFinder } from '@/components/warehouse/roomFinderContext';
import { SidebarShell } from '@/components/layout/SidebarShell';

type InventoryTab = 'rooms' | 'bins' | 'labels' | 'racks' | 'map';

function parseTab(raw: string | null): InventoryTab {
  if (raw === 'rooms' || raw === 'bins' || raw === 'racks' || raw === 'map') return raw;
  return 'labels';
}

export function WarehouseSidebarPanel() {
  // The room-finder query lives in RoomFinderContext; the inner panel reads it
  // (via the shell's `search` slot) so it must mount BELOW the provider.
  return (
    <RoomFinderProvider>
      <WarehouseSidebarInner />
    </RoomFinderProvider>
  );
}

function WarehouseSidebarInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const masterNavEnabled = useMasterNavEnabled();
  const { user } = useAuth();
  const tab = parseTab(searchParams.get('tab'));
  const { rooms, bins } = useLocations();
  const { query: roomQuery, setQuery: setRoomQuery } = useRoomFinder();
  const skuSearch = useWarehouseSkuSearch();

  const setTab = useCallback(
    (next: InventoryTab) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', next);
      // Strip filter params that don't apply to the new tab so the URL
      // doesn't leak Bins filters into Map view, etc.
      if (next !== 'bins') {
        params.delete('status');
        params.delete('q');
        params.delete('room');
      }
      if (next !== 'racks') {
        params.delete('code');
      }
      router.replace(`/warehouse?${params.toString()}`);
    },
    [router, searchParams],
  );

  const tabItems: HorizontalSliderItem[] = useMemo(
    () => [
      { id: 'labels', label: 'Labels', icon: Printer },
      { id: 'racks',  label: 'Racks',  icon: Layers },
      { id: 'rooms',  label: 'Rooms',  icon: Database, count: rooms.length },
      { id: 'bins',   label: 'Bins',   icon: Package,             count: bins.length },
      { id: 'map',    label: 'Map',    icon: MapPin },
    ],
    [rooms.length, bins.length],
  );

  // Tabs that display a list of rooms in the sidebar (and therefore want
  // the top search bar to filter rooms instead of running a global SKU/bin
  // lookup). Keeping one bar per surface — driven by a shared context —
  // beats two stacked search inputs both visually and for keyboard /
  // screen-reader navigation.
  const isRoomFinderTab = tab === 'rooms' || tab === 'labels' || tab === 'racks';
  const roomFinderPlaceholder =
    tab === 'labels'
      ? 'Search rooms to label by name or zone…'
      : tab === 'racks'
        ? 'Search rooms to print racks for…'
        : 'Search rooms by name or zone…';

  return (
    <SidebarShell
      className="bg-white"
      headerAbove={
        <>
          {!masterNavEnabled && (
            <div className={sidebarHeaderPillRowClass}>
              <HorizontalButtonSlider
                variant="nav"
                items={tabItems}
                value={tab}
                onChange={(id) => setTab(id as InventoryTab)}
                aria-label="Warehouse section"
                className="w-full"
              />
            </div>
          )}
        </>
      }
      search={
        isRoomFinderTab
          ? {
              value: roomQuery,
              onChange: setRoomQuery,
              onClear: () => setRoomQuery(''),
              placeholder: roomFinderPlaceholder,
              variant: 'blue',
            }
          : {
              value: skuSearch.value,
              onChange: (v) => { skuSearch.setValue(v); skuSearch.setOpen(true); },
              onSearch: skuSearch.handleSearch,
              onClear: skuSearch.handleClear,
              placeholder: 'Find product, SKU, or bin barcode…',
              variant: 'blue',
              isSearching: skuSearch.loading,
            }
      }
      searchGroup={
        !isRoomFinderTab
          ? (searchBar) => (
              <div className="space-y-2">
                {searchBar}
                {skuSearch.open && skuSearch.value.trim() && !looksLikeBinBarcode(skuSearch.value) && (
                  <div className={SIDEBAR_GUTTER}>
                    <WarehouseSkuSearchResults
                      loading={skuSearch.loading}
                      hits={skuSearch.hits}
                      onSelect={() => skuSearch.setOpen(false)}
                    />
                  </div>
                )}
              </div>
            )
          : undefined
      }
      bodyClassName="flex flex-col overflow-hidden p-0"
    >
      {tab === 'rooms' ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <RoomsSidebarList />
        </div>
      ) : (
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto scrollbar-hide">
          {tab === 'bins'   && <BinsSidebarBody />}
          {tab === 'labels' && <LabelsSidebarBody />}
          {tab === 'racks'  && <RacksSidebarBody />}
          {tab === 'map'    && <MapSidebarBody />}
        </div>
      )}

      <footer className="p-4 border-t border-gray-100 opacity-30 mt-auto text-center">
        <p className="text-eyebrow font-mono uppercase tracking-[0.2em] text-gray-500">
          {(user?.organizationName || 'Workspace').toUpperCase()} INV
        </p>
      </footer>
    </SidebarShell>
  );
}

// ── Labels sidebar — full picker on desktop; hint on mobile ──────────────
// On lg+ the BinLabelPrinter renders its compact `sidebar` variant here so
// the form sits next to the giant preview in the main pane. On smaller
// viewports the drawer is cramped, so we fall back to a hint and let
// users build the label in the main pane (which renders the full picker
// on <lg).

function LabelsSidebarBody() {
  return (
    <>
      <div className="hidden lg:block">
        <BinLabelPrinter variant="sidebar" />
      </div>
      <div className={`space-y-3 ${SIDEBAR_GUTTER} py-4 lg:hidden`}>
        <p className="text-caption text-gray-500">
          Build a bin label in the main workspace — pick a room, then drill into
          aisle, bay, level, and position. Live preview + QR render alongside the
          picker.
        </p>
        <p className="text-micro text-gray-400">
          Tip: ⌘P / Ctrl+P prints the current label once all steps are picked.
        </p>
      </div>
    </>
  );
}

// ── Racks sidebar — full picker on desktop; hint on mobile ───────────────

function RacksSidebarBody() {
  return (
    <>
      <div className="hidden lg:block">
        <RackLabelPrinter variant="sidebar" />
      </div>
      <div className={`space-y-3 ${SIDEBAR_GUTTER} py-4 lg:hidden`}>
        <p className="text-caption text-gray-500">
          Print a rack-level label in the main workspace — pick a room, then
          aisle, bay, and level. No position needed; one label covers the whole
          rack column on that level.
        </p>
        <p className="text-micro text-gray-400">
          Scanning a rack label opens the rack view so pickers and putaway can
          see everything on it at once.
        </p>
      </div>
    </>
  );
}

// ── Bins sidebar — recent activity feed (filters are in the main area) ────

function BinsSidebarBody() {
  return (
    <div className={`space-y-3 ${SIDEBAR_GUTTER} py-4`}>
      <p className="text-caption text-gray-500">
        Filter, sort, and select bins in the table to the right. Click any
        bin to see its full contents + history.
      </p>
      <div>
        <h3 className="mb-2 text-micro font-bold uppercase tracking-[0.16em] text-gray-500">
          Recent activity
        </h3>
        <RecentBinsActivity />
      </div>
    </div>
  );
}

function RecentBinsActivity() {
  // Reuse AuditTimeline scoped to "anything bin-shaped" by leaving the
  // identifier off. Falls back to an empty state if the timeline endpoint
  // requires an id — surface a hint then.
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-white p-3 text-center">
      <p className="text-caption text-gray-500">
        Click a bin in the table to see its history.
      </p>
      <p className="mt-1 text-micro text-gray-400">
        A cross-bin feed lands in the next update.
      </p>
    </div>
  );
}

// ── Map sidebar — view-mode toggle + legend ───────────────────────────────

function MapSidebarBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = parseView(searchParams.get('view'));

  const setView = (next: MapViewMode) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'map');
    params.set('view', next);
    router.replace(`/warehouse?${params.toString()}`);
  };

  return (
    <div className={`space-y-4 ${SIDEBAR_GUTTER} py-4`}>
      <div>
        <h3 className="mb-2 text-micro font-bold uppercase tracking-[0.16em] text-gray-500">
          View by
        </h3>
        <div className="grid grid-cols-3 gap-1">
          {(['fill', 'age', 'issues'] as MapViewMode[]).map((m) => {
            const active = view === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setView(m)}
                className={`ds-raw-button rounded-md px-2 py-1.5 text-caption font-semibold transition-colors ${
                  active
                    ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {m === 'fill' ? 'Fill' : m === 'age' ? 'Age' : 'Issues'}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-micro font-bold uppercase tracking-[0.16em] text-gray-500">
          Legend
        </h3>
        <MapLegend mode={view} />
      </div>
    </div>
  );
}

function parseView(raw: string | null): MapViewMode {
  if (raw === 'age' || raw === 'issues') return raw;
  return 'fill';
}
