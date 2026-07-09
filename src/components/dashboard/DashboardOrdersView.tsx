'use client';

/**
 * The dashboard's main (left) region: the active orders table for the current
 * `?view`, with a Suspense skeleton, plus the bulk-action capsule that pins to
 * the bottom when rows are checked. Presentational — selection state + actions
 * are owned by useDashboardBulkSelection. Extracted from the dashboard page.
 */

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { UnshippedTable } from '@/components/unshipped/UnshippedTable';
import { Loader2 } from '@/components/Icons';
import { ContextualSelectionBar } from '@/design-system/components/ContextualSelectionBar';
import { DASHBOARD_ORDERS_SELECTION_SCOPE } from '@/lib/selection/dashboard-scopes';
import type { SelectionAction } from '@/lib/selection/selection-actions';
import type { DashboardOrderView } from '@/utils/dashboard-search-state';
import type { DashSelectableRow } from '@/hooks/useDashboardBulkSelection';

// Phase 4 (bundle deferral): the three NON-default order views are code-split so
// their chunks load only when the user switches to that mode — the default
// Unshipped view (`UnshippedTable`, imported eagerly above) stays in the initial
// bundle so its first paint isn't gated on a second round-trip. `ssr: false`: the
// dashboard is a client shell behind BootGate, so there's no SSR to preserve.
function TableFallback() {
  return (
    <div className="flex-1 flex items-center justify-center bg-surface-canvas">
      <Loader2 className="w-8 h-8 animate-spin text-text-faint" />
    </div>
  );
}
const DashboardShippedTable = dynamic(
  () => import('@/components/shipped').then((m) => m.DashboardShippedTable),
  { ssr: false, loading: TableFallback },
);
const FBAShipmentsTable = dynamic(() => import('@/components/dashboard/FBAShipmentsTable'), {
  ssr: false,
  loading: TableFallback,
});
const WarrantyWorkspace = dynamic(
  () => import('@/components/warranty/WarrantyWorkspace').then((m) => m.WarrantyWorkspace),
  { ssr: false, loading: TableFallback },
);

interface DashboardOrdersViewProps {
  orderView: DashboardOrderView;
  selectMode: boolean;
  /** Flip select-mode — handed to each order board's in-toolbar Select toggle. */
  onToggleSelectMode: () => void;
  selectionEnabled: boolean;
  selectedRows: DashSelectableRow[];
  selectionActions: SelectionAction<DashSelectableRow>[];
}

export function DashboardOrdersView({
  orderView,
  selectMode,
  onToggleSelectMode,
  selectionEnabled,
  selectedRows,
  selectionActions,
}: DashboardOrdersViewProps) {
  return (
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="relative flex min-w-0 flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center bg-surface-canvas">
              <Loader2 className="w-8 h-8 animate-spin text-text-faint" />
            </div>
          }
        >
          {orderView === 'shipped' ? (
            <DashboardShippedTable selectMode={selectMode} onToggleSelectMode={onToggleSelectMode} />
          ) : orderView === 'fba' ? (
            <FBAShipmentsTable />
          ) : orderView === 'warranty' ? (
            <WarrantyWorkspace />
          ) : (
            // 'unshipped' (the merged pre-ship backlog) + the default.
            <UnshippedTable strictSearchScope selectMode={selectMode} onToggleSelectMode={onToggleSelectMode} />
          )}
        </Suspense>
      </div>

      {/* Bulk-action capsule — pins to the bottom of the orders region when rows
          are checked in the Unshipped / Shipped tables. */}
      {selectionEnabled ? (
        <ContextualSelectionBar
          scope={DASHBOARD_ORDERS_SELECTION_SCOPE}
          rows={selectedRows}
          actions={selectionActions}
        />
      ) : null}
    </div>
  );
}
