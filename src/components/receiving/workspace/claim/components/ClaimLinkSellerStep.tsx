import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';
import { ClaimTicketPicker } from './ClaimTicketPicker';
import { ClaimFiledBanner } from './ClaimFiledBanner';
import { ClaimSellerMessagePanel } from './ClaimSellerMessagePanel';

/**
 * The seller step (and the link-mode picker that precedes it): pick/confirm a
 * ticket, then draft the seller-facing message.
 */
export function ClaimLinkSellerStep({ c }: { c: ReceivingClaimController }) {
  return (
    <>
      {c.mode === 'link' && !c.filedTicket ? (
        <ClaimTicketPicker search={c.search} onSelect={c.selectLinkTicket} />
      ) : null}

      {c.filedTicket ? (
        <ClaimFiledBanner
          filedTicket={c.filedTicket}
          mode={c.mode}
          linkCommitted={c.linkCommitted}
          unlinking={c.unlinking}
          onUnlink={c.handleBannerUnlink}
        />
      ) : null}

      <ClaimSellerMessagePanel seller={c.seller} filedTicket={c.filedTicket} />
    </>
  );
}
