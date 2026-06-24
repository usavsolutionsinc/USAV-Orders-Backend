import { PaneHeaderTabs } from '@/components/ui/pane-header';
import type { ClaimModalMode } from '../claim-types';
import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';

/** New-ticket/Link-existing mode tabs. */
export function ClaimWizardNav({ c }: { c: ReceivingClaimController }) {
  return (
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
  );
}
