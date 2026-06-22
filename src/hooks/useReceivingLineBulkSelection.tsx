'use client';

/**
 * Shared bulk-selection for the receiving-line history feeds (the global-header
 * pencil + contextual action bar). Both the Receiving dashboard's History /
 * Incoming list and the Tech dashboard's testing-history list select
 * `ReceivingLineRow`s with the IDENTICAL action set — Copy / Print / Create
 * support ticket / Send to staff / Send to phone — and the same single-line
 * claim modal. They differ only in the selection scope, which surface gates the
 * pencil, and the per-row copy format. This hook owns the universal mechanic so
 * neither dashboard hand-rolls its own copy.
 *
 * Consolidates the previously-duplicated bulk-selection blocks from
 * TechDashboard and ReceivingDashboard.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePageSelection } from '@/hooks/usePageHeader';
import { useTableSelection } from '@/hooks/useTableSelection';
import { emitToggleAll } from '@/lib/selection/table-selection';
import type { SelectionAction } from '@/lib/selection/selection-actions';
import { printProductLabel, printProductLabels } from '@/lib/print/printProductLabel';
import { Copy, Printer, MessageSquare, User, Smartphone } from '@/components/Icons';
import { toast } from '@/lib/toast';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

interface UseReceivingLineBulkSelectionArgs {
  /** table-selection scope shared by the table, the header toggle, and the bar. */
  scope: string;
  /** Whether the selectable surface is currently shown (gates the pencil). */
  active: boolean;
  /** Per-row copy line (the surfaces order their fields differently). */
  formatCopyRow: (row: ReceivingLineRow) => string;
}

export interface ReceivingLineBulkSelection {
  selectMode: boolean;
  selectedRows: ReceivingLineRow[];
  /** Single-line claim row opened from the "Create support ticket" action. */
  claimRow: ReceivingLineRow | null;
  setClaimRow: React.Dispatch<React.SetStateAction<ReceivingLineRow | null>>;
  exitSelectMode: () => void;
  bulkActions: SelectionAction<ReceivingLineRow>[];
}

export function useReceivingLineBulkSelection({
  scope,
  active,
  formatCopyRow,
}: UseReceivingLineBulkSelectionArgs): ReceivingLineBulkSelection {
  const [selectMode, setSelectMode] = useState(false);
  const selectedRows = useTableSelection<ReceivingLineRow>(scope, (r) => r.id);
  const [claimRow, setClaimRow] = useState<ReceivingLineRow | null>(null);

  // Leaving the selectable surface exits select mode.
  useEffect(() => {
    if (!active && selectMode) setSelectMode(false);
  }, [active, selectMode]);

  const exitSelectMode = useCallback(() => {
    emitToggleAll(scope, 'none');
    setSelectMode(false);
  }, [scope]);

  const handleCopyDetails = useCallback(
    (rows: ReceivingLineRow[]) => {
      const text = rows.map(formatCopyRow).filter(Boolean).join('\n');
      void navigator.clipboard?.writeText(text).then(
        () => toast.success(`Copied ${rows.length} line${rows.length === 1 ? '' : 's'}`),
        () => toast.error('Copy failed'),
      );
    },
    [formatCopyRow],
  );

  // Print one product label per selected line — serial-level when serials are
  // loaded on the row, else a single SKU label. Same pipeline as the workspace's
  // Pass + Print.
  const handlePrintLabels = useCallback((rows: ReceivingLineRow[]) => {
    let printed = 0;
    for (const r of rows) {
      const sku = (r.sku || '').trim();
      if (!sku) continue;
      const serials = (r.serials ?? [])
        .map((s) => (s.serial_number || '').trim())
        .filter(Boolean);
      if (serials.length > 0) {
        printProductLabels({ sku, serialNumbers: serials });
        printed += serials.length;
      } else {
        printProductLabel({ sku });
        printed += 1;
      }
    }
    if (printed > 0) toast.success(`Printing ${printed} label${printed === 1 ? '' : 's'}`);
    else toast.error('No SKU on the selected line(s)');
  }, []);

  const bulkActions = useMemo<SelectionAction<ReceivingLineRow>[]>(
    () => [
      {
        key: 'copy',
        label: 'Copy details',
        icon: <Copy className="h-4 w-4" />,
        tone: 'blue',
        primary: true,
        run: handleCopyDetails,
      },
      {
        key: 'print',
        label: 'Print labels',
        icon: <Printer className="h-4 w-4" />,
        run: handlePrintLabels,
      },
      {
        key: 'ticket',
        label: 'Create support ticket',
        icon: <MessageSquare className="h-4 w-4" />,
        maxSelected: 1,
        disabledReason: 'Select a single line to file a ticket',
        run: (rows) => {
          if (rows[0]) setClaimRow(rows[0]);
        },
      },
      {
        key: 'staff',
        label: 'Send to staff',
        icon: <User className="h-4 w-4" />,
        enabled: () => false,
        disabledReason: 'Coming next — needs assignment backend',
        run: () => {
          /* disabled until the backend lands */
        },
      },
      {
        key: 'phone',
        label: 'Send to phone',
        icon: <Smartphone className="h-4 w-4" />,
        enabled: () => false,
        disabledReason: 'Coming next — needs phone push channel',
        run: () => {
          /* disabled until the backend lands */
        },
      },
    ],
    [handleCopyDetails, handlePrintLabels],
  );

  // Selection toggle — the pencil in the global header's right actions while the
  // selectable surface is up. No page title in the header.
  usePageSelection(
    active
      ? {
          active: selectMode,
          onToggle: () => (selectMode ? exitSelectMode() : setSelectMode(true)),
        }
      : null,
    [active, selectMode, exitSelectMode],
  );

  return { selectMode, selectedRows, claimRow, setClaimRow, exitSelectMode, bulkActions };
}
