'use client';

/**
 * Page-level overlays for `/receiving` that sit beside the right-pane column: the
 * carton details stack (with lazy enrich), the local-pickup review/reprint
 * panel, and the single-line support-claim modal from the bulk bar. Pure
 * presentational; state + handlers come from the dashboard's hooks. Extracted
 * from ReceivingDashboard; behaviour is unchanged.
 */

import { AnimatePresence } from 'framer-motion';
import { ReceivingClaimModal } from '@/components/receiving/workspace/ReceivingClaimModal';
import { ReceivingDetailsStack } from '@/components/station/ReceivingDetailsStack';
import { LocalPickupReviewPanel } from '@/components/work-orders/LocalPickupReviewPanel';
import { toast } from '@/lib/toast';
import type { ReceivingDetailsLog } from '@/components/station/receiving-details-log';
import type { ReceivingLineRow } from '@/components/station/ReceivingLinesTable';

interface ReceivingDashboardOverlaysProps {
  overlayLog: ReceivingDetailsLog | null;
  onCloseOverlayLog: () => void;
  onOverlayLogUpdated: () => void;
  onOverlayLogDeleted: () => void;
  pickupReviewOrderId: number | null;
  onClosePickupReview: () => void;
  claimRow: ReceivingLineRow | null;
  onCloseClaim: () => void;
  onClaimFiled: () => void;
}

export function ReceivingDashboardOverlays({
  overlayLog,
  onCloseOverlayLog,
  onOverlayLogUpdated,
  onOverlayLogDeleted,
  pickupReviewOrderId,
  onClosePickupReview,
  claimRow,
  onCloseClaim,
  onClaimFiled,
}: ReceivingDashboardOverlaysProps) {
  return (
    <>
      <AnimatePresence>
        {overlayLog ? (
          <ReceivingDetailsStack
            log={overlayLog}
            onClose={onCloseOverlayLog}
            onUpdated={onOverlayLogUpdated}
            onDeleted={onOverlayLogDeleted}
          />
        ) : null}
      </AnimatePresence>

      {pickupReviewOrderId != null ? (
        <LocalPickupReviewPanel
          mode="reprint"
          orderId={pickupReviewOrderId}
          onClose={onClosePickupReview}
        />
      ) : null}

      {claimRow ? (
        <ReceivingClaimModal
          open
          row={claimRow}
          onClose={onCloseClaim}
          onTicketCreated={(tk) => {
            toast.success(`Claim filed — ${tk}`);
            onClaimFiled();
          }}
        />
      ) : null}
    </>
  );
}
