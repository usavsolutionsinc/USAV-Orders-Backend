import { PaneHeaderTabs } from '@/components/ui/pane-header';
import { LinearWorkflowStepper } from '@/components/receiving/workspace/ReceivingProgressStepper';
import { CLAIM_WIZARD_STEPS, type ClaimModalMode } from '../claim-types';
import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';

/** Two-step stepper + New-ticket/Link-existing mode tabs. */
export function ClaimWizardNav({ c }: { c: ReceivingClaimController }) {
  return (
    <>
      <div className="flex justify-center">
        <LinearWorkflowStepper
          steps={CLAIM_WIZARD_STEPS}
          states={c.claimStepStates}
          ariaLabel="Claim filing steps"
          size="compact"
          className="w-full max-w-[15rem]"
          onStepClick={c.handleClaimStepClick}
          isStepDisabled={(key) => key === 'seller' && !c.sellerStepReady}
        />
      </div>

      <div className="flex justify-center border-b border-gray-100 pb-1">
        <PaneHeaderTabs<ClaimModalMode>
          tabs={[
            { value: 'create', label: 'New ticket' },
            { value: 'link', label: 'Link existing' },
          ]}
          value={c.mode}
          onChange={c.handleModeChange}
        />
      </div>
    </>
  );
}
