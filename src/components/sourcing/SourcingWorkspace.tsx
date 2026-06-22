'use client';

/**
 * Right pane for /sourcing. Reads ?mode= and renders one of: Queue (prioritized
 * demand), Scout (model → compatible parts + market search), Watchlist (saved
 * candidates), Searches (standing watches), Suppliers (rollup). The sidebar
 * (SourcingSidebarPanel) owns the search/filter inputs; this pane is the display.
 *
 * Thin composition layer — each pane lives under `./workspace/`.
 */

import { useSearchParams } from 'next/navigation';
import { resolveSourcingMode } from './sourcing-shared';
import { ScoutPane } from './workspace/ScoutPane';
import { QueuePane } from './workspace/QueuePane';
import { SearchesPane } from './workspace/SearchesPane';
import { SuppliersPane } from './workspace/SuppliersPane';
import { WatchlistPane } from './workspace/WatchlistPane';

export function SourcingWorkspace() {
  const searchParams = useSearchParams();
  const mode = resolveSourcingMode(searchParams.get('mode'));

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      {mode === 'scout' ? (
        <ScoutPane />
      ) : mode === 'queue' ? (
        <QueuePane />
      ) : mode === 'searches' ? (
        <SearchesPane />
      ) : mode === 'suppliers' ? (
        <SuppliersPane />
      ) : (
        <WatchlistPane />
      )}
    </div>
  );
}
