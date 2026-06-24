import { HorizontalButtonSlider } from '@/components/ui/HorizontalButtonSlider';
import type { ClaimType } from '@/components/sidebar/receiving/receiving-sidebar-shared';
import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';
import { ClaimPhotoPicker } from './ClaimPhotoPicker';
import { ClaimTemplateEditor } from './ClaimTemplateEditor';

/** Create → internal step: pick claim type, describe it, attach photos, edit the ticket. */
export function ClaimInternalStep({ c }: { c: ReceivingClaimController }) {
  return (
    <>
      <div>
        <p className="mb-1 text-[10px] font-black uppercase tracking-[0.14em] text-gray-500">Claim type</p>
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

      <ClaimTemplateEditor template={c.template} filedTicket={c.filedTicket} />

      <p className="text-[11px] font-semibold leading-5 text-gray-500">
        Review the ticket draft, attach evidence, and file the internal ticket. Step 2 drafts the
        seller-facing follow-up with the ticket number.
      </p>
    </>
  );
}
