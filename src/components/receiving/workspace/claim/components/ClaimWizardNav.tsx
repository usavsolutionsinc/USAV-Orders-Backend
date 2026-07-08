import { PaneHeaderTabs } from '@/components/ui/pane-header';
import { LinearWorkflowStepper } from '@/components/receiving/workspace/ReceivingProgressStepper';
import { CLAIM_WIZARD_STEPS, LINK_WIZARD_STEPS, type ClaimModalMode } from '../claim-types';
import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';

/**
 * New-ticket / Link-existing mode tabs, plus a linear progress stepper for the
 * active flow — create: Photos → Ticket → Review → Filed → Seller; link: Find →
 * Linked → Seller. The stepper is the stable map: clicking a reached step jumps
 * to it; only the body below crossfades.
 */
export function ClaimWizardNav({ c }: { c: ReceivingClaimController }) {
  return (
    <div className="space-y-2.5 border-b border-border-hairline pb-2.5">
      <div className="flex justify-start">
        <PaneHeaderTabs<ClaimModalMode>
          tabs={[
            { value: 'create', label: 'New ticket' },
            { value: 'link', label: 'Link existing' },
          ]}
          value={c.mode}
          onChange={c.handleModeChange}
        />
      </div>

      {c.mode === 'create' ? (
        <LinearWorkflowStepper
          steps={CLAIM_WIZARD_STEPS}
          states={c.claimStepStates}
          ariaLabel="Claim progress"
          size="compact"
          className="mx-auto w-full max-w-md px-2"
          onStepClick={c.handleClaimStepClick}
          isStepDisabled={c.isCreateStepDisabled}
        />
      ) : (
        <LinearWorkflowStepper
          steps={LINK_WIZARD_STEPS}
          states={c.linkStepStates}
          ariaLabel="Link claim progress"
          size="compact"
          className="mx-auto w-full max-w-xs px-2"
          onStepClick={c.handleLinkStepClick}
          isStepDisabled={c.isLinkStepDisabled}
        />
      )}
    </div>
  );
}
