import { Archive, ChevronLeft, Copy, Link2, Loader2 } from '@/components/Icons';
import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';

function ProgressChip({ label, dotClass = 'bg-rose-400' }: { label: string; dotClass?: string }) {
  return (
    <div className="inline-flex h-8 min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[11px] font-semibold text-slate-600">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />
      <span className="truncate">{label}</span>
    </div>
  );
}

const ghostBtn =
  'inline-flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50';
const roseBtn =
  'inline-flex h-9 items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-sm transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50';
const blueBtn =
  'inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
const blueOutlineBtn =
  'inline-flex h-9 items-center gap-1.5 rounded-xl border border-blue-200 bg-white px-3.5 text-[11px] font-bold uppercase tracking-[0.14em] text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50';

/** The Copy + Finish pair shared by the create- and link-mode seller steps. */
function SellerActions({ c }: { c: ReceivingClaimController }) {
  const { seller } = c;
  return (
    <>
      <button
        type="button"
        disabled={!seller.sellerMessage.trim()}
        onClick={() => void seller.handleCopySellerMessage()}
        className={blueOutlineBtn}
      >
        <Copy className="h-4 w-4" />
        Copy
      </button>
      <button
        type="button"
        onClick={() => void seller.finishSellerStep()}
        disabled={seller.aiLoading || (c.mode === 'link' && !c.linkCommitted)}
        className={blueBtn}
      >
        Finish seller msg
      </button>
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
      : 'NAS backup incomplete'
    : null;
  const progressDot = !busy && c.archiveState?.ok ? 'bg-emerald-500' : 'bg-rose-400';
  const progressLabel = c.submitting
    ? 'Filing ticket'
    : c.archiveSubmitting
      ? 'Archiving photos'
      : c.linking
        ? 'Linking ticket'
        : c.unlinking
          ? 'Unlinking ticket'
          : step === 'confirm'
            ? (archiveLabel ?? 'Ticket filed')
            : step === 'seller'
              ? 'Seller message'
              : step === 'review'
                ? 'Ready to file'
                : c.mode === 'link'
                  ? 'Choose a ticket'
                  : 'Draft claim';

  // The "Back" affordance only on the editable pre-file create steps.
  const showBack = isCreate && (step === 'compose' || step === 'review');

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <button type="button" onClick={c.onClose} disabled={busy} className={ghostBtn}>
          Cancel
        </button>
        {showBack ? (
          <button type="button" onClick={c.goBack} disabled={busy} className={ghostBtn}>
            <ChevronLeft className="h-3.5 w-3.5" />
            Back
          </button>
        ) : null}
      </div>

      <div className="flex min-w-0 items-center justify-end gap-2">
        <ProgressChip label={progressLabel} dotClass={progressDot} />

        {/* ── Create flow ─────────────────────────────────────────────── */}
        {isCreate && step === 'photos' ? (
          <button type="button" onClick={c.goNext} className={roseBtn}>
            Next: Ticket →
          </button>
        ) : null}

        {isCreate && step === 'compose' ? (
          <button
            type="button"
            onClick={c.goNext}
            disabled={!c.composeComplete}
            title={c.composeComplete ? undefined : 'Add a subject and body first'}
            className={roseBtn}
          >
            Next: Review →
          </button>
        ) : null}

        {isCreate && step === 'review' ? (
          <>
            <button
              type="button"
              onClick={() => void c.submitDryRun()}
              disabled={c.testCreating || c.submitting || !c.row.receiving_id || !c.composeComplete}
              title="Rehearse the whole flow (Review → Confirm → Seller) without filing a real ticket — uses #TEST, no Zendesk/NAS/DB writes"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-dashed border-amber-300 bg-amber-50/70 px-3.5 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {c.testCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Dry run →
            </button>
            <button
              type="button"
              onClick={c.submitInternal}
              disabled={c.submitting || c.archiveSubmitting || !c.row.receiving_id || !c.composeComplete}
              className={roseBtn}
            >
              {c.submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              {c.submitting ? 'Filing…' : 'File ticket & back up →'}
            </button>
          </>
        ) : null}

        {isCreate && step === 'confirm' ? (
          <button type="button" onClick={c.continueToSeller} className={blueBtn}>
            Continue to seller →
          </button>
        ) : null}

        {isCreate && step === 'seller' ? <SellerActions c={c} /> : null}

        {/* ── Link flow ───────────────────────────────────────────────── */}
        {!isCreate ? (
          <>
            {c.filedTicket && !c.linkCommitted ? (
              <button
                type="button"
                onClick={c.submitLink}
                disabled={c.linking || !c.row.receiving_id || !search.selectedTicket}
                className={roseBtn}
              >
                {c.linking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {c.linking
                  ? 'Linking…'
                  : search.selectedTicket
                    ? `Link ticket #${search.selectedTicket.id} →`
                    : 'Link ticket'}
              </button>
            ) : null}
            {c.filedTicket && c.linkCommitted ? (
              <button
                type="button"
                onClick={c.archiveToNas}
                disabled={c.archiveSubmitting || !c.row.receiving_id}
                title={`Back up this carton's photos to the NAS folder named ${c.filedTicket.number}`}
                className={blueOutlineBtn}
              >
                {c.archiveSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
                {c.archiveSubmitting ? 'Archiving…' : 'Archive to NAS'}
              </button>
            ) : null}
            <SellerActions c={c} />
          </>
        ) : null}
      </div>
    </div>
  );
}
