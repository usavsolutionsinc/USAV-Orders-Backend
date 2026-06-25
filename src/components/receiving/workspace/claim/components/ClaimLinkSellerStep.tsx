import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';
import { ClaimTicketPicker } from './ClaimTicketPicker';
import { ClaimSellerStep } from './ClaimSellerStep';

/**
 * Link mode: pick an existing ticket, then draft the seller message against it.
 * Reuses the shared {@link ClaimSellerStep} for the banner + message + reply.
 */
export function ClaimLinkSellerStep({ c }: { c: ReceivingClaimController }) {
  return (
    <>
      {c.mode === 'link' && !c.filedTicket ? (
        <ClaimTicketPicker search={c.search} onSelect={c.selectLinkTicket} />
      ) : null}

      <ClaimSellerStep c={c} />
    </>
  );
}
