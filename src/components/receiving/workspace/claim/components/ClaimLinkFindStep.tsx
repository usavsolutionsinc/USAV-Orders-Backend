import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';
import { ClaimTicketPicker } from './ClaimTicketPicker';

/**
 * Link step 1 — Find. Search and select an existing Zendesk ticket to attach to
 * this carton/line. Selecting highlights the row and arms the footer "Link
 * ticket" action; committing advances to the "Linked" step.
 */
export function ClaimLinkFindStep({ c }: { c: ReceivingClaimController }) {
  return (
    <>
      <ClaimTicketPicker search={c.search} onSelect={c.selectLinkTicket} />

      <p className="text-caption font-semibold leading-5 text-gray-500">
        Pick the existing ticket this carton belongs to, then link it. You&apos;ll confirm the link
        and draft the seller message next.
      </p>
    </>
  );
}
