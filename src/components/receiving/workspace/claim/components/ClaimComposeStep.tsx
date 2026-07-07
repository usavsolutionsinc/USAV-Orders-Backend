import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';
import { ClaimTemplateEditor } from './ClaimTemplateEditor';

/**
 * Step 2 — Ticket. Edit the full Zendesk subject and body, seeded from the
 * server template for the chosen claim type. Nothing is filed here — Review
 * (step 3) is where the operator commits.
 */
export function ClaimComposeStep({ c }: { c: ReceivingClaimController }) {
  return (
    <>
      <ClaimTemplateEditor template={c.template} filedTicket={c.filedTicket} row={c.row} />

      <p className="text-caption font-semibold leading-5 text-text-soft">
        Refine the subject and body. Continue to Review to confirm everything before the ticket is
        filed and the photos are backed up.
      </p>
    </>
  );
}
