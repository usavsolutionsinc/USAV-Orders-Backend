'use client';

import { RightPaneOverlay } from '@/components/ui/RightPaneOverlay';
import {
  useReceivingClaimController,
  type ClaimModalProps,
} from './claim/hooks/useReceivingClaimController';
import { ClaimModalHeader } from './claim/components/ClaimModalHeader';
import { ClaimWizardNav } from './claim/components/ClaimWizardNav';
import { ClaimInternalStep } from './claim/components/ClaimInternalStep';
import { ClaimLinkSellerStep } from './claim/components/ClaimLinkSellerStep';
import { ClaimModalFooter } from './claim/components/ClaimModalFooter';

/**
 * Make-a-claim modal. Filed against the current receiving carton (and
 * optionally the active line). Posts to /api/receiving/zendesk-claim which
 * creates the ticket directly via the Zendesk REST API. A second mode links
 * an EXISTING Zendesk ticket instead (/api/receiving/zendesk-claim/link);
 * tickets already linked to other items are hidden from that picker.
 *
 * On success, the ticket # is handed to `onTicketCreated`, which the parent
 * uses to auto-fill the existing `zendesk` field in the Support FlowSection.
 *
 * Thin composition layer — all state/effects/data live in
 * {@link useReceivingClaimController} and the per-section components under
 * `./claim/`.
 */
export function ReceivingClaimModal(props: ClaimModalProps) {
  const c = useReceivingClaimController(props);
  const showInternal = c.createStep === 'internal' && c.mode === 'create';

  return (
    <RightPaneOverlay
      open={c.open}
      onClose={c.onClose}
      align="center"
      resizable
      storageKey="receiving-claim-modal-size"
      minWidth={460}
      minHeight={420}
      className="-mt-8 h-[min(86vh,44rem)] w-[min(94vw,52rem)]"
      aria-label="File a claim"
    >
      <ClaimModalHeader
        row={c.row}
        submitting={c.submitting}
        archiveSubmitting={c.archiveSubmitting}
        onClose={c.onClose}
      />

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[13px]">
        <ClaimWizardNav c={c} />
        {showInternal ? <ClaimInternalStep c={c} /> : <ClaimLinkSellerStep c={c} />}
      </div>

      <ClaimModalFooter c={c} />
    </RightPaneOverlay>
  );
}
