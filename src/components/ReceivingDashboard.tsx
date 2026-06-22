'use client';

/**
 * `/receiving` right pane — thin composition layer. Headerless; driven entirely
 * by the sidebar's mode pills (`?mode=`) + selection state.
 *
 *   ?mode=pickup            → LocalPickupEditPanel (staged-item editor)
 *   workspace open          → ReceivingLineWorkspace (focused line editor)
 *   no selection, receive   → ReceivingLinesTable (history)
 *
 * Logic lives in focused hooks; the bulk-selection layer is the SHARED
 * `useReceivingLineBulkSelection` (also used by the Tech dashboard) so the two
 * receiving-line history feeds don't hand-roll parallel copies:
 *   - useReceivingDashboardMode .... `?mode=` → surface flags
 *   - useReceivingWorkspacePane .... workspace + nav + scan loader + recovery
 *   - useReceivingDetailOverlays ... details stack / pickup review / incoming panel
 *   - useReceivingLineBulkSelection  shared History/Incoming bulk actions + claim
 */

import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useReducedMotion } from 'framer-motion';
import { useRealtimeInvalidation } from '@/hooks/useRealtimeInvalidation';
import { useRealtimeToasts } from '@/hooks/useRealtimeToasts';
import { useAuth } from '@/contexts/AuthContext';
import { dispatchReceivingWorkspaceClose } from '@/utils/events';
import {
  RECEIVING_SELECTION_SCOPE,
  type ReceivingLineRow,
} from '@/components/station/ReceivingLinesTable';
import { LocalPickupEditPanel } from '@/components/work-orders/LocalPickupEditPanel';
import { useReceivingLineBulkSelection } from '@/hooks/useReceivingLineBulkSelection';
import { useReceivingDashboardMode } from '@/components/receiving/useReceivingDashboardMode';
import { useReceivingWorkspacePane } from '@/components/receiving/useReceivingWorkspacePane';
import { useReceivingDetailOverlays } from '@/components/receiving/useReceivingDetailOverlays';
import { ReceivingRightPane } from '@/components/receiving/ReceivingRightPane';
import { ReceivingDashboardOverlays } from '@/components/receiving/ReceivingDashboardOverlays';

/** Copy line for a receiving carton/line: PO • SKU • tracking. */
function formatReceivingCopyRow(r: ReceivingLineRow): string {
  const po = (r.zoho_purchaseorder_number || r.zoho_purchaseorder_id || '').trim();
  const sku = (r.sku || '').trim();
  const tracking = (r.tracking_number || '').trim();
  return [po && `PO ${po}`, sku && `SKU ${sku}`, tracking && `TRK ${tracking}`]
    .filter(Boolean)
    .join(' • ');
}

export default function ReceivingDashboard() {
  useRealtimeInvalidation({ receiving: true });
  useRealtimeToasts('receiving');
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefersReducedMotion = useReducedMotion();
  const { user } = useAuth();
  const staffId = String(user?.staffId ?? '');

  const { mode, isPickupMode, isTriageMode, isIncomingMode, isTableOnlyMode } =
    useReceivingDashboardMode();

  const { workspace, setWorkspace, nav, setNav, scanInFlight } = useReceivingWorkspacePane();

  const {
    overlayLog,
    setOverlayLog,
    pickupReviewOrderId,
    setPickupReviewOrderId,
    incomingDetails,
    setIncomingDetails,
    enrichOverlayLog,
  } = useReceivingDetailOverlays(isIncomingMode);

  const { selectMode, selectedRows, claimRow, setClaimRow, exitSelectMode, bulkActions } =
    useReceivingLineBulkSelection({
      scope: RECEIVING_SELECTION_SCOPE,
      active: isTableOnlyMode,
      formatCopyRow: formatReceivingCopyRow,
    });

  const closeWorkspace = useCallback(() => {
    setWorkspace(null);
    setNav(null);
    dispatchReceivingWorkspaceClose();
    window.dispatchEvent(new CustomEvent('receiving-clear-line'));
    // Triage stays in triage (its rail auto-selects the next top); Unbox close
    // returns to the History tab as a "back to list".
    if (!isTriageMode) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('mode', 'history');
      router.replace(`/receiving?${params.toString()}`);
    }
  }, [isTriageMode, router, searchParams, setWorkspace, setNav]);

  if (isPickupMode) {
    return (
      <div className="flex h-full w-full overflow-hidden bg-[linear-gradient(180deg,#f8fbfb_0%,#ffffff_16%)]">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <LocalPickupEditPanel />
        </div>
      </div>
    );
  }

  // Triage (label "Receiving") deliberately shares the SAME right pane as Unbox:
  // the selected carton opens in the full ReceivingLineWorkspace, so identifying
  // a carton before unboxing uses the exact same editor. It is NOT table-only,
  // so it falls through to the workspace-overlay path.

  return (
    <div className="flex h-full w-full overflow-hidden bg-[linear-gradient(180deg,#f8fbfb_0%,#ffffff_16%)]">
      <ReceivingRightPane
        mode={mode}
        isTableOnlyMode={isTableOnlyMode}
        isTriageMode={isTriageMode}
        isIncomingMode={isIncomingMode}
        selectMode={selectMode}
        selectedRows={selectedRows}
        bulkActions={bulkActions}
        workspace={workspace}
        nav={nav}
        scanInFlight={scanInFlight}
        staffId={staffId}
        prefersReducedMotion={prefersReducedMotion}
        incomingDetails={incomingDetails}
        onCloseIncoming={() => {
          setIncomingDetails(null);
          window.dispatchEvent(new CustomEvent('receiving-clear-line'));
        }}
        onCloseWorkspace={closeWorkspace}
      />

      <ReceivingDashboardOverlays
        overlayLog={overlayLog}
        onCloseOverlayLog={() => setOverlayLog(null)}
        onOverlayLogUpdated={() => {
          if (overlayLog) void enrichOverlayLog(Number(overlayLog.id));
        }}
        onOverlayLogDeleted={() => setOverlayLog(null)}
        pickupReviewOrderId={pickupReviewOrderId}
        onClosePickupReview={() => setPickupReviewOrderId(null)}
        claimRow={claimRow}
        onCloseClaim={() => setClaimRow(null)}
        onClaimFiled={() => {
          setClaimRow(null);
          exitSelectMode();
        }}
      />
    </div>
  );
}
