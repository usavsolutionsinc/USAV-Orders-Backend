import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';
import { ClaimFiledBanner } from './ClaimFiledBanner';
import { ClaimSellerMessagePanel } from './ClaimSellerMessagePanel';
import { ClaimTicketReply } from './ClaimTicketReply';

/**
 * Step 5 — Seller message. The filed/linked ticket banner, the AI-drafted
 * seller-facing message editor, and the in-Zendesk reply box. Shared by the
 * create flow (after Confirmation) and link mode (after a ticket is chosen).
 */
export function ClaimSellerStep({ c }: { c: ReceivingClaimController }) {
  return (
    <div className="divide-y divide-border-hairline [&>section]:py-3 [&>section:first-child]:pt-0">
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

      <ClaimTicketReply reply={c.reply} filedTicket={c.filedTicket} prefill={c.seller.sellerMessage} />
    </div>
  );
}
