import { ChevronLeft, Copy, Link2, Loader2 } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';
import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';

/** The Copy + Finish pair shared by the create- and link-mode seller steps. */
function SellerActions({ c }: { c: ReceivingClaimController }) {
  const { seller } = c;
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="md"
        disabled={!seller.sellerMessage.trim()}
        onClick={() => void seller.handleCopySellerMessage()}
        icon={<Copy className="h-4 w-4" />}
      >
        Copy
      </Button>
      <Button
        type="button"
        variant="primary"
        size="md"
        onClick={() => void seller.finishSellerStep()}
        disabled={seller.aiLoading || (c.mode === 'link' && !c.linkCommitted)}
      >
        Finish seller msg
      </Button>
    </>
  );
}

/** Contextual footer actions — varies by wizard step and mode. */
export function ClaimModalFooter({ c }: { c: ReceivingClaimController }) {
  const { search } = c;
  const busy = c.submitting || c.archiveSubmitting || c.linking || c.unlinking;
  const isCreate = c.mode === 'create';
  const step = c.createStep;
  const linkStep = c.linkStep;

  const showBack = isCreate
    ? step === 'compose' || step === 'review'
    : linkStep === 'linked' || linkStep === 'seller';
  const onBack = isCreate ? c.goBack : c.goLinkBack;

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border-hairline bg-surface-canvas px-4 py-2.5">
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" size="md" onClick={c.onClose} disabled={busy}>
          Cancel
        </Button>
        {showBack ? (
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onBack}
            disabled={busy}
            icon={<ChevronLeft className="h-3.5 w-3.5" />}
          >
            Back
          </Button>
        ) : null}
      </div>

      <div className="flex min-w-0 items-center justify-end gap-2">
        {/* ── Create flow ─────────────────────────────────────────────── */}
        {isCreate && step === 'photos' ? (
          <Button type="button" variant="primary" size="md" onClick={c.goNext}>
            Next: Ticket →
          </Button>
        ) : null}

        {isCreate && step === 'compose' ? (
          c.composeComplete ? (
            <Button type="button" variant="primary" size="md" onClick={c.goNext} disabled={!c.composeComplete}>
              Next: Review →
            </Button>
          ) : (
            <HoverTooltip label="Add a subject and body first" asChild>
              <Button type="button" variant="primary" size="md" onClick={c.goNext} disabled={!c.composeComplete}>
                Next: Review →
              </Button>
            </HoverTooltip>
          )
        ) : null}

        {isCreate && step === 'review' ? (
          <Button
            type="button"
            variant="danger"
            size="md"
            onClick={c.submitInternal}
            disabled={c.submitting || c.archiveSubmitting || !c.row.receiving_id || !c.composeComplete}
            icon={c.submitting || c.archiveSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          >
            {c.submitting
              ? 'Filing…'
              : c.archiveSubmitting
                ? 'Saving photos…'
                : 'File ticket & back up →'}
          </Button>
        ) : null}

        {isCreate && step === 'confirm' ? (
          <Button type="button" variant="primary" size="md" onClick={c.continueToSeller}>
            Continue to seller →
          </Button>
        ) : null}

        {isCreate && step === 'seller' ? <SellerActions c={c} /> : null}

        {/* ── Link flow ───────────────────────────────────────────────── */}
        {!isCreate && linkStep === 'find' ? (
          <Button
            type="button"
            variant={search.selectedTicket ? 'danger' : 'primary'}
            size="md"
            onClick={c.submitLink}
            disabled={c.linking || !c.row.receiving_id || !search.selectedTicket}
            icon={c.linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          >
            {c.linking
              ? 'Linking…'
              : search.selectedTicket
                ? `Link ticket #${search.selectedTicket.id} →`
                : 'Choose a ticket'}
          </Button>
        ) : null}

        {!isCreate && linkStep === 'linked' ? (
          <Button type="button" variant="primary" size="md" onClick={c.continueToSeller}>
            Continue to seller →
          </Button>
        ) : null}

        {!isCreate && linkStep === 'seller' ? <SellerActions c={c} /> : null}
      </div>
    </div>
  );
}
