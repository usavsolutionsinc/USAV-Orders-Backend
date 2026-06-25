import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import type { ClaimType } from '@/components/sidebar/receiving/receiving-sidebar-shared';
import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';
import { ClaimPhotoPicker } from './ClaimPhotoPicker';

/**
 * Step 1 — Photos. Classify the claim and acknowledge/select the evidence
 * photos that will attach to the ticket. The body draft is composed in step 2.
 */
export function ClaimPhotosStep({ c }: { c: ReceivingClaimController }) {
  return (
    <>
      <div>
        <p className="mb-1 text-[10px] font-black uppercase tracking-[0.14em] text-gray-500">
          Claim type
        </p>
        <HorizontalButtonSlider
          items={c.claimTypeItems}
          value={c.claimType}
          onChange={(id) => c.setClaimType(id as ClaimType)}
          variant="nav"
          size="md"
          aria-label="Claim type"
        />
      </div>

      <ClaimPhotoPicker photos={c.photos} />

      <p className="text-[11px] font-semibold leading-5 text-gray-500">
        Pick the claim type and the evidence photos. Checked photos upload to the Zendesk ticket;
        every PO photo is also backed up to a local folder named after the case #.
      </p>
    </>
  );
}
