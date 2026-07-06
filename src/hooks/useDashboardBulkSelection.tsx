'use client';

/**
 * Dashboard bulk-selection (the in-board "Select" toggle) for the Unshipped +
 * Shipped order tables.
 *
 * The two tables share one selection scope (only one mounts per `?view`); FBA +
 * Warranty opt out. This hook owns the select-mode state, the view-flip resets,
 * and the Copy / Print / Send / Delete bulk actions. The toggle now lives in
 * each board's own top-right toolbar (via {@link BoardSelectToggle}) rather than
 * the global header, so this hook exposes `toggleSelectMode` for the board to
 * drive; the floating action bar is rendered by the page from `selectionActions`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Printer, Smartphone, Trash2, User } from '@/components/Icons';
import { useTableSelection } from '@/hooks/useTableSelection';
import { useDeleteOrderRow } from '@/hooks/useDeleteOrderRow';
import { emitToggleAll } from '@/lib/selection/table-selection';
import { DASHBOARD_ORDERS_SELECTION_SCOPE } from '@/lib/selection/dashboard-scopes';
import type { SelectionAction } from '@/lib/selection/selection-actions';
import { printProductLabel, printProductLabels } from '@/lib/print/printProductLabel';
import { toast } from '@/lib/toast';
import type { DashboardOrderView } from '@/utils/dashboard-search-state';

/**
 * Minimal shape the dashboard selection bar needs from a row — satisfied by
 * both the Unshipped (`ShippedOrder`) and Shipped (`PackerRecord`) records.
 */
export type DashSelectableRow = {
  id: number | string;
  order_id?: string | null;
  sku?: string | null;
  serial_number?: string | null;
  shipping_tracking_number?: string | null;
  tracking_number?: string | null;
  packer_log_id?: number | null;
};

export interface DashboardBulkSelection {
  /** True on the surfaces that support selection (Unshipped / Shipped). */
  selectionEnabled: boolean;
  /** Whether select-mode is currently armed. */
  selectMode: boolean;
  /** Flip select-mode on/off — driven by each board's in-toolbar Select toggle. */
  toggleSelectMode: () => void;
  /** The currently checked rows for the shared dashboard scope. */
  selectedRows: DashSelectableRow[];
  /** Copy / Print / Send / Delete actions for the contextual selection bar. */
  selectionActions: SelectionAction<DashSelectableRow>[];
}

export function useDashboardBulkSelection(
  orderView: DashboardOrderView,
): DashboardBulkSelection {
  const selectionEnabled = orderView !== 'fba' && orderView !== 'warranty';
  const isShippedView = orderView === 'shipped';
  const [selectMode, setSelectMode] = useState(false);
  const selectedRows = useTableSelection<DashSelectableRow>(
    DASHBOARD_ORDERS_SELECTION_SCOPE,
    (r) => Number(r.id),
  );
  const deleteOrderRow = useDeleteOrderRow();

  const exitSelectMode = useCallback(() => {
    emitToggleAll(DASHBOARD_ORDERS_SELECTION_SCOPE, 'none');
    setSelectMode(false);
  }, []);

  const toggleSelectMode = useCallback(() => {
    setSelectMode((armed) => {
      if (armed) emitToggleAll(DASHBOARD_ORDERS_SELECTION_SCOPE, 'none');
      return !armed;
    });
  }, []);

  // Switching view (or losing the selectable surface) exits select mode so a
  // stale toggle never lingers on FBA/Warranty.
  useEffect(() => {
    if (!selectionEnabled && selectMode) exitSelectMode();
  }, [selectionEnabled, selectMode, exitSelectMode]);
  useEffect(() => {
    // Reset on any view flip — the row types + delete semantics differ.
    setSelectMode(false);
  }, [orderView]);

  const handleCopyDetails = useCallback((rows: DashSelectableRow[]) => {
    const text = rows
      .map((r) => {
        const order = String(r.order_id || '').trim();
        const sku = String(r.sku || '').trim();
        const tracking = String(r.shipping_tracking_number || r.tracking_number || '').trim();
        const serial = String(r.serial_number || '').trim();
        return [order && `Order ${order}`, sku && `SKU ${sku}`, tracking && `TRK ${tracking}`, serial && `SN ${serial}`]
          .filter(Boolean)
          .join(' • ');
      })
      .filter(Boolean)
      .join('\n');
    if (!text) {
      toast.error('Nothing to copy on the selected row(s)');
      return;
    }
    void navigator.clipboard?.writeText(text).then(
      () => toast.success(`Copied ${rows.length} row${rows.length === 1 ? '' : 's'}`),
      () => toast.error('Copy failed'),
    );
  }, []);

  const handlePrintLabels = useCallback((rows: DashSelectableRow[]) => {
    let printed = 0;
    for (const r of rows) {
      const sku = String(r.sku || '').trim();
      if (!sku) continue;
      const serial = String(r.serial_number || '').trim();
      if (serial) printProductLabels({ sku, serialNumbers: [serial] });
      else printProductLabel({ sku });
      printed += 1;
    }
    if (printed > 0) toast.success(`Printing ${printed} label${printed === 1 ? '' : 's'}`);
    else toast.error('No SKU on the selected row(s)');
  }, []);

  const handleDelete = useCallback(
    async (rows: DashSelectableRow[]) => {
      if (rows.length === 0) return;
      const noun = isShippedView ? 'shipped record' : 'order';
      const label = rows.length === 1 ? `this ${noun}` : `these ${rows.length} ${noun}s`;
      if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
      try {
        if (isShippedView) {
          // No bulk packer-log endpoint — delete each (the Shipped row id IS
          // its station_activity_log id; packer_log_id is the fallback key).
          const results = await Promise.allSettled(
            rows.map((r) =>
              deleteOrderRow.mutateAsync({
                rowSource: 'packing_log',
                activityLogId: Number(r.id),
                packerLogId: r.packer_log_id ?? undefined,
              }),
            ),
          );
          const failed = results.filter((x) => x.status === 'rejected').length;
          if (failed > 0) toast.error(`${failed} of ${rows.length} could not be deleted`);
          else toast.success(rows.length === 1 ? 'Record deleted' : `${rows.length} records deleted`);
        } else {
          const orderIds = rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
          await deleteOrderRow.mutateAsync({ rowSource: 'order', orderIds });
          toast.success(orderIds.length === 1 ? 'Order deleted' : `${orderIds.length} orders deleted`);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Delete failed');
      } finally {
        exitSelectMode();
        window.dispatchEvent(new CustomEvent('dashboard-refresh'));
      }
    },
    [isShippedView, deleteOrderRow, exitSelectMode],
  );

  const selectionActions = useMemo<SelectionAction<DashSelectableRow>[]>(
    () => [
      { key: 'copy', label: 'Copy details', icon: <Copy className="h-4 w-4" />, tone: 'blue', primary: true, run: handleCopyDetails },
      { key: 'print', label: 'Print labels', icon: <Printer className="h-4 w-4" />, run: handlePrintLabels },
      { key: 'staff', label: 'Send to staff', icon: <User className="h-4 w-4" />, run: () => toast('Send to staff — coming next') },
      { key: 'phone', label: 'Send to phone', icon: <Smartphone className="h-4 w-4" />, run: () => toast('Send to phone — coming next') },
      { key: 'delete', label: 'Delete', icon: <Trash2 className="h-4 w-4" />, tone: 'red', run: handleDelete },
    ],
    [handleCopyDetails, handlePrintLabels, handleDelete],
  );

  return { selectionEnabled, selectMode, toggleSelectMode, selectedRows, selectionActions };
}
