'use client';

/**
 * Inventory sidebar panel.
 *
 * The dashboard chrome owns the "Inventory" title. This panel renders:
 *   - The SKU/bin finder (always visible)
 *   - Pills with counts: Labels · Rooms · Bins · Map
 *   - Tab-specific body: a small contextual hint per tab. Every workspace
 *     (rooms board, location label printer, bins table, warehouse map) lives in
 *     the main area via InventoryShell so it can use the full content width.
 */

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { sidebarHeaderBandClass } from '@/components/layout/header-shell';
import {
  HorizontalButtonSlider,
  type HorizontalSliderItem,
} from '@/components/ui/HorizontalButtonSlider';
import { LayoutDashboard, Box, Printer, MapPin } from '@/components/Icons';
import { useLocations } from '@/hooks/useLocations';
import { SkuLocationFinder } from '@/components/inventory/SkuLocationFinder';
import { MapLegend, type MapViewMode } from '@/components/inventory/WarehouseMap';

type InventoryTab = 'rooms' | 'bins' | 'labels' | 'map';

function parseTab(raw: string | null): InventoryTab {
  if (raw === 'rooms' || raw === 'bins' || raw === 'map') return raw;
  return 'labels';
}

export function InventorySidebarPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get('tab'));
  const { rooms, bins } = useLocations();

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
      router.replace(`/inventory?${params.toString()}`);
    },
    [router, searchParams],
  );

  const tabItems: HorizontalSliderItem[] = useMemo(
    () => [
      { id: 'labels', label: 'Labels', icon: Printer },
      { id: 'rooms',  label: 'Rooms',  icon: LayoutDashboard, count: rooms.length },
      { id: 'bins',   label: 'Bins',   icon: Box,             count: bins.length },
      { id: 'map',    label: 'Map',    icon: MapPin },
    ],
    [rooms.length, bins.length],
  );

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white">
      <div className={sidebarHeaderBandClass}>
        <div className="space-y-2 px-3 py-2">
          <HorizontalButtonSlider
            variant="nav"
            items={tabItems}
            value={tab}
            onChange={(id) => setTab(id as InventoryTab)}
            aria-label="Inventory section"
          />
          <SkuLocationFinder />
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto scrollbar-hide">
        {tab === 'rooms'  && <RoomsSidebarBody />}
        {tab === 'bins'   && <BinsSidebarBody />}
        {tab === 'labels' && <LabelsSidebarBody />}
        {tab === 'map'    && <MapSidebarBody />}
      </div>

      <footer className="p-4 border-t border-gray-100 opacity-30 mt-auto text-center">
        <p className="text-[7px] font-mono uppercase tracking-[0.2em] text-gray-500">USAV INV</p>
      </footer>
    </div>
  );
}

// ── Rooms sidebar — context hint; CRUD lives in the main pane workspace ──

function RoomsSidebarBody() {
  return (
    <div className="space-y-3 p-4">
      <p className="text-[11px] text-gray-500">
        Add, rename, reorder, and delete rooms in the main workspace. Tap the
        pencil there to enter edit mode.
      </p>
    </div>
  );
}

// ── Labels sidebar — context hint; the printer lives in the main pane ────

function LabelsSidebarBody() {
  return (
    <div className="space-y-3 p-4">
      <p className="text-[11px] text-gray-500">
        Build a bin label in the main workspace — pick a room, then drill into
        aisle, bay, level, and position. Live preview + QR render alongside the
        picker.
      </p>
      <p className="text-[10px] text-gray-400">
        Tip: ⌘P / Ctrl+P prints the current label once all steps are picked.
      </p>
    </div>
  );
}

// ── Bins sidebar — recent activity feed (filters are in the main area) ────

function BinsSidebarBody() {
  return (
    <div className="space-y-3 p-4">
      <p className="text-[11px] text-gray-500">
        Filter, sort, and select bins in the table to the right. Click any
        bin to see its full contents + history.
      </p>
      <div>
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">
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
      <p className="text-[11px] text-gray-500">
        Click a bin in the table to see its history.
      </p>
      <p className="mt-1 text-[10px] text-gray-400">
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
    router.replace(`/inventory?${params.toString()}`);
  };

  return (
    <div className="space-y-4 p-4">
      <div>
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">
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
                className={`rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors ${
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
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">
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
