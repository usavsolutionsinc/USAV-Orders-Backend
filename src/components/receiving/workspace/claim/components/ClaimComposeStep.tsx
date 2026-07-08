import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';
import { ClaimTemplateEditor } from './ClaimTemplateEditor';
import { ClaimRecipientsField } from './ClaimRecipientsField';

/**
 * Step 2 — Ticket. Edit the full Zendesk subject and body (seeded from the
 * server template for the chosen claim type) and choose the recipients — a
 * private internal note by default, or a public reply that CCs a vendor /
 * teammate. Nothing is filed here — Review (step 3) is where the operator commits.
 */
export function ClaimComposeStep({ c }: { c: ReceivingClaimController }) {
  return (
    <div className="space-y-3">
      <ClaimTemplateEditor template={c.template} filedTicket={c.filedTicket} row={c.row} />
      <ClaimRecipientsField c={c} />
    </div>
  );
}
