'use client';

/**
 * Testing-history bulk selection for the tech dashboard. A thin wrapper over the
 * shared {@link useReceivingLineBulkSelection} (Copy / Print / Ticket / Send +
 * claim modal + header pencil) — this layer only supplies the tech-specific
 * scope, copy format, and the row-click → Testing-workspace navigation.
 */

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { stripCrossSurfaceParams } from '@/lib/surface-isolation';
import { TESTING_SELECTION_SCOPE } from '@/components/tech/TestingHistoryList';
import {
  useReceivingLineBulkSelection,
  type ReceivingLineBulkSelection,
} from '@/hooks/useReceivingLineBulkSelection';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

/** Copy line for a tested unit: SKU • serials • PO. */
function formatTestingCopyRow(r: ReceivingLineRow): string {
  const sku = (r.sku || '').trim();
  const serials = (r.serials ?? [])
    .map((s) => (s.serial_number || '').trim())
    .filter(Boolean)
    .join('/');
  const po = (r.zoho_purchaseorder_number || r.zoho_purchaseorder_id || '').trim();
  return [sku && `SKU ${sku}`, serials && `SN ${serials}`, po && `PO ${po}`]
    .filter(Boolean)
    .join(' • ');
}

export interface TechTestingSelection {
  testingSelectMode: boolean;
  testingSelectedRows: ReceivingLineRow[];
  testingClaimRow: ReceivingLineRow | null;
  setTestingClaimRow: ReceivingLineBulkSelection['setClaimRow'];
  exitTestingSelect: () => void;
  /** Open the clicked history row in the Testing (Recent) workspace. */
  openTestingLine: () => void;
  testingBulkActions: ReceivingLineBulkSelection['bulkActions'];
}

export function useTechTestingSelection(isTestingHistory: boolean): TechTestingSelection {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { selectMode, selectedRows, claimRow, setClaimRow, exitSelectMode, bulkActions } =
    useReceivingLineBulkSelection({
      scope: TESTING_SELECTION_SCOPE,
      active: isTestingHistory,
      formatCopyRow: formatTestingCopyRow,
    });

  const openTestingLine = useCallback(() => {
    const params = stripCrossSurfaceParams(
      pathname || '/test',
      new URLSearchParams(searchParams.toString()),
    );
    params.set('view', 'testing');
    const qs = params.toString();
    router.replace(qs ? `${pathname || '/test'}?${qs}` : pathname || '/test');
  }, [router, pathname, searchParams]);

  return {
    testingSelectMode: selectMode,
    testingSelectedRows: selectedRows,
    testingClaimRow: claimRow,
    setTestingClaimRow: setClaimRow,
    exitTestingSelect: exitSelectMode,
    openTestingLine,
    testingBulkActions: bulkActions,
  };
}
