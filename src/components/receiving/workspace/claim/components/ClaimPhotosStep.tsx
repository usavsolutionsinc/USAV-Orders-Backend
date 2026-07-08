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
        <p className="mb-1 text-micro font-black uppercase tracking-[0.14em] text-text-soft">
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

      <ClaimPhotoPicker photos={c.photos} receivingId={c.row.receiving_id} />
    </>
  );
}
