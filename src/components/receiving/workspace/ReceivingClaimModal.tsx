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
    <RightPaneOverlay open={c.open} onClose={c.onClose} align="right" width={672} aria-label="File a claim">
      <ClaimModalHeader row={c.row} submitting={c.submitting} onClose={c.onClose} />

      <div className="space-y-4 overflow-y-auto px-5 py-4">
        <ClaimWizardNav c={c} />
        {showInternal ? <ClaimInternalStep c={c} /> : <ClaimLinkSellerStep c={c} />}
      </div>

      <ClaimModalFooter c={c} />
    </RightPaneOverlay>
  );
}
