'use client';

import { SidebarShell } from '@/components/layout/SidebarShell';
import { sidebarHeaderPillRowClass } from '@/components/layout/header-shell';
import { cn } from '@/utils/_cn';
import { CarrierSyncDialog } from '@/components/sidebar/receiving/CarrierSyncDialog';
import { IncomingSyncDialog } from '@/components/sidebar/receiving/IncomingSyncDialog';
import { IncomingAttachTrackingPopover } from '@/components/sidebar/receiving/IncomingAttachTrackingPopover';
import { IncomingViewBand } from '@/components/receiving/IncomingViewBand';
import { useIncomingFilters } from './incoming/useIncomingFilters';
import { useIncomingSummary } from './incoming/useIncomingSummary';
import { useIncomingSyncActions } from './incoming/useIncomingSyncActions';
import { IncomingFilterDropdown } from './incoming/IncomingFilterDropdown';
import { IncomingSyncButtons } from './incoming/IncomingSyncButtons';

export type {
  IncomingDeliveryState,
  IncomingCarrierBreakdown,
  IncomingSummary,
} from './incoming/incoming-summary-types';

/**
 * Incoming-mode sidebar — replaces the StationScanBar / Recent rail for
 * `?mode=incoming`. Self-contained: reads/writes the URL params it owns
 * (`q`/`state`/`sort`/`po_*`) and polls its own aggregate-count endpoint;
 * ReceivingLinesTable reads the same params and refetches — no prop-drilling.
 *
 * Thin composition layer — state/logic live under `./incoming/`.
 */
export function IncomingSidebarPanel() {
  const filters = useIncomingFilters();
  const summary = useIncomingSummary();
  const sync = useIncomingSyncActions();

  return (
    <>
      <SidebarShell
        className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-white"
        search={{ value: filters.search, onChange: filters.setSearch, placeholder: 'Search PO #, tracking, SKU…' }}
        filter={{
          label: 'Filters',
          refinements: filters.refinements,
          activeCount: filters.activeFilterCount,
          onClearAll: filters.activeFilterCount > 0 ? filters.clearFilters : undefined,
          renderDropdown: () => <IncomingFilterDropdown filters={filters} summary={summary} />,
        }}
        headerBelow={
          <>
            <div className={cn(sidebarHeaderPillRowClass, 'h-auto min-h-[40px] items-start pt-1 pb-2.5')}>
              <IncomingViewBand />
            </div>
            <div className="shrink-0 space-y-2 border-b border-gray-200 bg-white pb-2 pt-2.5">
              <IncomingSyncButtons sync={sync} />
              <div className="flex flex-col">
                <IncomingAttachTrackingPopover />
              </div>
            </div>
          </>
        }
      />
      <CarrierSyncDialog
        open={sync.syncDialogOpen}
        onClose={() => sync.setSyncDialogOpen(false)}
        isRunning={sync.isSyncing}
        elapsedMs={sync.syncElapsedMs}
        onCancel={sync.handleCancelSync}
        carriers={sync.carrierTabs}
        result={sync.syncResult}
      />
      <IncomingSyncDialog
        open={sync.incSyncOpen}
        kind={sync.incSyncKind}
        isRunning={sync.incSyncRunning}
        elapsedMs={sync.incSyncElapsedMs}
        result={sync.incSyncResult}
        onClose={() => sync.setIncSyncOpen(false)}
      />
    </>
  );
}
