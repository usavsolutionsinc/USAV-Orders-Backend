import { VisibilityToggle } from '@/components/ui/VisibilityToggle';
import { CcEmailField } from './CcEmailField';
import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';

/**
 * Recipients control for the compose step — choose whether the opening comment
 * is a private internal note (default) or a public reply, and CC collaborator
 * emails when public. Threads into the create submit as `notePublic` + `ccEmails`
 * (the server only emails CCs on a public comment). Reuses the shared
 * {@link VisibilityToggle} so it matches the Support console's internal/public
 * control exactly.
 */
export function ClaimRecipientsField({ c }: { c: ReceivingClaimController }) {
  const { notePublic, setNotePublic, ccEmails, setCcEmails } = c;

  return (
    <section className="space-y-2 rounded-lg border border-border-soft bg-surface-canvas/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-micro font-black uppercase tracking-[0.14em] text-text-soft">Recipients</p>
        <VisibilityToggle
          value={notePublic}
          onChange={setNotePublic}
          internalLabel="Internal note"
          publicLabel="Public + CC"
        />
      </div>

      {notePublic ? (
        <>
          <CcEmailField
            emails={ccEmails}
            onChange={setCcEmails}
            placeholder="Add vendor / teammate email to CC…"
          />
          <p className="text-micro font-medium text-blue-700">
            Files the opening comment as a public reply — emails the CC recipients. Attached photos ride along.
          </p>
        </>
      ) : (
        <p className="text-micro font-medium text-text-faint">
          Private internal note — not emailed to anyone.
        </p>
      )}
    </section>
  );
}
