'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { RightPaneOverlay } from '@/components/ui/RightPaneOverlay';
import { framerPresence, framerTransition } from '@/design-system/foundations/motion-framer';
import {
  useMotionPresence,
  useMotionTransition,
} from '@/design-system/foundations/motion-framer-hooks';
import {
  useReceivingClaimController,
  type ClaimModalProps,
} from './claim/hooks/useReceivingClaimController';
import { ClaimModalHeader } from './claim/components/ClaimModalHeader';
import { ClaimWizardNav } from './claim/components/ClaimWizardNav';
import { ClaimPhotosStep } from './claim/components/ClaimPhotosStep';
import { ClaimComposeStep } from './claim/components/ClaimComposeStep';
import { ClaimReviewStep } from './claim/components/ClaimReviewStep';
import { ClaimConfirmStep } from './claim/components/ClaimConfirmStep';
import { ClaimSellerStep } from './claim/components/ClaimSellerStep';
import { ClaimLinkFindStep } from './claim/components/ClaimLinkFindStep';
import { ClaimLinkedStep } from './claim/components/ClaimLinkedStep';
import { ClaimModalFooter } from './claim/components/ClaimModalFooter';
import type { ReceivingClaimController } from './claim/hooks/useReceivingClaimController';

/**
 * Make-a-claim modal. Filed against the current receiving carton (and
 * optionally the active line). Posts to /api/receiving/zendesk-claim which
 * creates the ticket directly via the Zendesk REST API. A second mode links
 * an EXISTING Zendesk ticket instead (/api/receiving/zendesk-claim/link);
 * tickets already linked to other items are hidden from that picker.
 *
 * The create flow is a linear five-step wizard — Photos → Ticket → Review →
 * Filed → Seller — where each step owns one job. The progress stepper is the
 * stable map; only the step body below crossfades. On success, the ticket # is
 * handed to `onTicketCreated`, which the parent uses to auto-fill the Support
 * FlowSection.
 *
 * Thin composition layer — all state/effects/data live in
 * {@link useReceivingClaimController} and the per-step components under
 * `./claim/`.
 */
export function ReceivingClaimModal(props: ClaimModalProps) {
  const c = useReceivingClaimController(props);

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

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[13px]">
        <ClaimWizardNav c={c} />
        <ClaimStepBody c={c} />
      </div>

      <ClaimModalFooter c={c} />
    </RightPaneOverlay>
  );
}

/** Crossfades the active step body keyed on the step id; the stepper stays put. */
function ClaimStepBody({ c }: { c: ReceivingClaimController }) {
  const presence = useMotionPresence(framerPresence.workbenchPane);
  const transition = useMotionTransition(framerTransition.workbenchPaneMount);
  // Key the crossfade on the active step of whichever wizard is running.
  const stepKey = c.mode === 'link' ? `link:${c.linkStep}` : `create:${c.createStep}`;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={stepKey}
        initial={presence.initial}
        animate={presence.animate}
        exit={presence.exit}
        transition={transition}
        className="space-y-3 pt-3"
      >
        {c.mode === 'link' ? (
          c.linkStep === 'find' ? (
            <ClaimLinkFindStep c={c} />
          ) : c.linkStep === 'linked' ? (
            <ClaimLinkedStep c={c} />
          ) : (
            <ClaimSellerStep c={c} />
          )
        ) : c.createStep === 'photos' ? (
          <ClaimPhotosStep c={c} />
        ) : c.createStep === 'compose' ? (
          <ClaimComposeStep c={c} />
        ) : c.createStep === 'review' ? (
          <ClaimReviewStep c={c} />
        ) : c.createStep === 'confirm' ? (
          <ClaimConfirmStep c={c} />
        ) : (
          <ClaimSellerStep c={c} />
        )}
      </motion.div>
    </AnimatePresence>
  );
}
