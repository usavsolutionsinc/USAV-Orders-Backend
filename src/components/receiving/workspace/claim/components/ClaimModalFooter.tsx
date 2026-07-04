import { ChevronLeft, Copy, Link2, Loader2 } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';
import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';

function ProgressChip({ label, dotClass = 'bg-rose-400' }: { label: string; dotClass?: string }) {
  return (
    <div className="inline-flex h-8 min-w-0 items-center gap-2 rounded-xl border border-border-soft bg-surface-canvas px-3 text-caption font-semibold text-text-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />
      <span className="truncate">{label}</span>
    </div>
  );
}

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
        className="border-blue-200 text-blue-700 hover:bg-blue-50"
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

  const archiveLabel = c.archiveState
    ? c.archiveState.ok
      ? `Backed up ${c.archiveState.copied}/${c.archiveState.total}`
      : 'Local backup incomplete'
    : null;
  const linkStep = c.linkStep;
  const progressDot = !busy && c.archiveState?.ok ? 'bg-emerald-500' : 'bg-rose-400';
  const progressLabel = c.submitting
    ? 'Filing ticket'
    : c.archiveSubmitting
      ? 'Saving photos'
      : c.linking
        ? 'Linking ticket'
        : c.unlinking
          ? 'Unlinking ticket'
          : !isCreate
            ? linkStep === 'find'
              ? search.selectedTicket
                ? `Ticket #${search.selectedTicket.id} selected`
                : 'Choose a ticket'
              : linkStep === 'linked'
                ? (archiveLabel ?? 'Ticket linked')
                : 'Seller message'
            : step === 'confirm'
              ? (archiveLabel ?? 'Ticket filed')
              : step === 'seller'
                ? 'Seller message'
                : step === 'review'
                  ? 'Ready to file'
                  : 'Draft claim';

  // The "Back" affordance: editable pre-file create steps, or the post-link
  // link steps (back to the picker / confirmation).
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
        <ProgressChip label={progressLabel} dotClass={progressDot} />

        {/* ── Create flow ─────────────────────────────────────────────── */}
        {isCreate && step === 'photos' ? (
          <Button type="button" variant="danger" size="md" onClick={c.goNext}>
            Next: Ticket →
          </Button>
        ) : null}

        {isCreate && step === 'compose' ? (
          c.composeComplete ? (
            <Button type="button" variant="danger" size="md" onClick={c.goNext} disabled={!c.composeComplete}>
              Next: Review →
            </Button>
          ) : (
            <HoverTooltip label="Add a subject and body first" asChild>
              <Button type="button" variant="danger" size="md" onClick={c.goNext} disabled={!c.composeComplete}>
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
            icon={c.submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          >
            {c.submitting ? 'Filing…' : 'File ticket & back up →'}
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
            variant="danger"
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
