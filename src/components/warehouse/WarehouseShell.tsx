'use client';

/**
 * Main-area host for the warehouse map. Reads `?tab=` and dispatches to the
 * right sub-view. The sidebar (WarehouseSidebarPanel) drives `?tab=`, the
 * Bins tab also reads `?status=`, `?room=`, `?q=` from the URL.
 */

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocations } from '@/hooks/useLocations';
import { useBinsOverview, type BinsOverviewRow } from '@/hooks/useBinsOverview';
import { BinsTable } from './BinsTable';
import { BinsFilterBar, useBinsFilterParams, filterRowsByStatus } from './BinsFilterBar';
import { BinsBulkActionBar } from './BinsBulkActionBar';
import { BinDetailFlyout } from './BinDetailFlyout';
import { RoomsBoard } from './RoomsBoard';
import { LabelPrintWorkspace } from './LabelPrintWorkspace';
import { WarehouseMap, type MapViewMode } from './WarehouseMap';

type InventoryTab = 'rooms' | 'bins' | 'labels' | 'map';

function parseTab(raw: string | null): InventoryTab {
  if (raw === 'rooms' || raw === 'bins' || raw === 'map') return raw;
  return 'labels';
}

export function WarehouseShell() {
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get('tab'));

  if (tab === 'rooms')  return <RoomsBoard />;
  if (tab === 'labels') return <LabelPrintWorkspace />;
  if (tab === 'map')    return <MapTabBody />;
  return <BinsTabBody />;
}

// ── Bins tab ────────────────────────────────────────────────────────────────

function BinsTabBody() {
  const { status, room, q, onParamChange } = useBinsFilterParams();
  const { rooms } = useLocations();
  const { rows, counts, loading } = useBinsOverview({ room, q });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [flyoutRow, setFlyoutRow] = useState<BinsOverviewRow | null>(null);

  const visibleRows = useMemo(
    () => filterRowsByStatus(rows, status),
    [rows, status],
  );

  // Drop selections that no longer match the visible set (filter changed).
  const reconciledSelected = useMemo(() => {
    if (selected.size === 0) return selected;
    const visibleIds = new Set(visibleRows.map((r) => r.id));
    let changed = false;
    const next = new Set<number>();
    for (const id of selected) {
      if (visibleIds.has(id)) next.add(id);
      else changed = true;
    }
    return changed ? next : selected;
  }, [selected, visibleRows]);

  return (
    <>
      <div className="space-y-4">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Bins</h1>
            <p className="text-sm text-gray-500">
              {loading
                ? 'Loading…'
                : `${visibleRows.length} of ${counts.total} bin${counts.total === 1 ? '' : 's'}`}
            </p>
          </div>
        </header>

        <BinsFilterBar
          counts={counts}
          rooms={rooms}
          status={status}
          room={room}
          onParamChange={onParamChange}
        />

        <BinsTable
          rows={visibleRows}
          loading={loading}
          selected={reconciledSelected}
          onSelectChange={setSelected}
          onRowClick={(row) => setFlyoutRow(row)}
        />
      </div>

      <BinsBulkActionBar
        selected={reconciledSelected}
        rows={visibleRows}
        onClearSelection={() => setSelected(new Set())}
      />

      <BinDetailFlyout
        row={flyoutRow}
        onClose={() => setFlyoutRow(null)}
      />
    </>
  );
}

// ── Map tab ─────────────────────────────────────────────────────────────────

function MapTabBody() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const mode = parseMapMode(searchParams.get('view'));
  const showEmpty = searchParams.get('showEmpty') === '1';
  const { rows, loading } = useBinsOverview({ pollMs: 60_000 });
  const [flyoutRow, setFlyoutRow] = useState<BinsOverviewRow | null>(null);

  const toggleEmpty = () => {
    const sp = new URLSearchParams(searchParams.toString());
    if (showEmpty) sp.delete('showEmpty');
    else sp.set('showEmpty', '1');
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <>
      <div className="space-y-4">
        <header className="flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Warehouse map</h1>
            <p className="text-sm text-gray-500">
              {loading ? 'Loading…' : `Viewing by ${mode === 'fill' ? 'fill %' : mode === 'age' ? 'last counted' : 'issues'}`}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleEmpty}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              showEmpty
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
            aria-pressed={showEmpty}
          >
            {showEmpty ? 'Hide' : 'Show'} empty bins
          </button>
        </header>

        <WarehouseMap
          rows={rows}
          loading={loading}
          mode={mode}
          onCellClick={(row) => setFlyoutRow(row)}
          showEmpty={showEmpty}
        />
      </div>

      <BinDetailFlyout
        row={flyoutRow}
        onClose={() => setFlyoutRow(null)}
      />
    </>
  );
}

function parseMapMode(raw: string | null): MapViewMode {
  if (raw === 'age' || raw === 'issues') return raw;
  return 'fill';
}
