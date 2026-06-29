'use client';

/**
 * The dashboard's main (left) region: the active orders table for the current
 * `?view`, with a Suspense skeleton, plus the bulk-action capsule that pins to
 * the bottom when rows are checked. Presentational — selection state + actions
 * are owned by useDashboardBulkSelection. Extracted from the dashboard page.
 */

import { Suspense } from 'react';
import { DashboardShippedTable } from '@/components/shipped';
import { UnshippedTable } from '@/components/unshipped/UnshippedTable';
import FBAShipmentsTable from '@/components/dashboard/FBAShipmentsTable';
import { WarrantyWorkspace } from '@/components/warranty/WarrantyWorkspace';
import { Loader2 } from '@/components/Icons';
import { ContextualSelectionBar } from '@/design-system/components/ContextualSelectionBar';
import { DASHBOARD_ORDERS_SELECTION_SCOPE } from '@/lib/selection/dashboard-scopes';
import type { SelectionAction } from '@/lib/selection/selection-actions';
import type { DashboardOrderView } from '@/utils/dashboard-search-state';
import type { DashSelectableRow } from '@/hooks/useDashboardBulkSelection';

interface DashboardOrdersViewProps {
  orderView: DashboardOrderView;
  selectMode: boolean;
  selectionEnabled: boolean;
  selectedRows: DashSelectableRow[];
  selectionActions: SelectionAction<DashSelectableRow>[];
}

export function DashboardOrdersView({
  orderView,
  selectMode,
  selectionEnabled,
  selectedRows,
  selectionActions,
}: DashboardOrdersViewProps) {
  return (
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="relative flex min-w-0 flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center bg-gray-50">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          }
        >
          {orderView === 'shipped' ? (
            <DashboardShippedTable selectMode={selectMode} />
          ) : orderView === 'fba' ? (
            <FBAShipmentsTable />
          ) : orderView === 'warranty' ? (
            <WarrantyWorkspace />
          ) : (
            // 'unshipped' (the merged pre-ship backlog) + the default.
            <UnshippedTable strictSearchScope selectMode={selectMode} />
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
