import { Archive, Copy, Link2, Loader2 } from '@/components/Icons';
import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';

function ProgressChip({ label, dotClass = 'bg-rose-400' }: { label: string; dotClass?: string }) {
  return (
    <div className="inline-flex h-8 min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[11px] font-semibold text-slate-600">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />
      <span className="truncate">{label}</span>
    </div>
  );
}

/** Contextual footer actions — varies by wizard step and mode. */
export function ClaimModalFooter({ c }: { c: ReceivingClaimController }) {
  const { template, search, seller } = c;
  const onInternalCreate = c.createStep === 'internal' && c.mode === 'create';
  const onSellerStep = c.createStep === 'seller';
  const archiveLabel = c.archiveState
    ? c.archiveState.ok
      ? `Backed up ${c.archiveState.copied}/${c.archiveState.total} → ${c.archiveState.folder ?? ''}`.trim()
      : 'NAS backup incomplete'
    : null;
  const idle = !c.submitting && !c.archiveSubmitting && !c.linking && !c.unlinking;
  // Emerald dot only on a clean backup; rose when it failed/was partial.
  const progressDot = idle && c.archiveState?.ok ? 'bg-emerald-500' : 'bg-rose-400';

  const progressLabel = c.submitting
    ? 'Creating ticket'
    : c.archiveSubmitting
      ? 'Archiving photos'
      : c.linking
        ? 'Linking ticket'
        : c.unlinking
          ? 'Unlinking ticket'
          : archiveLabel
            ? archiveLabel
            : c.createStep === 'seller' && c.filedTicket
              ? 'Seller message ready'
              : c.filedTicket
                ? 'Ticket filed'
                : c.mode === 'link'
                  ? 'Choose a ticket'
                  : 'Ready to file';

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-4 py-2.5">
      <button
        type="button"
        onClick={c.onClose}
        disabled={c.submitting || c.archiveSubmitting || c.linking || c.unlinking}
        className="inline-flex h-9 items-center rounded-xl border border-gray-200 bg-white px-3.5 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
      >
        Cancel
      </button>

      <div className="flex min-w-0 items-center justify-end gap-2">
        {onInternalCreate ? (
          c.filedTicket ? (
            <>
              <ProgressChip label={progressLabel} dotClass={progressDot} />
              <button
                type="button"
                onClick={() => c.setCreateStep('seller')}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-sm transition-colors hover:bg-rose-700"
              >
                Seller msg →
              </button>
            </>
          ) : (
            <>
              <ProgressChip label={progressLabel} dotClass={progressDot} />
              <button
                type="button"
                onClick={() => void c.continueTest()}
                disabled={c.testSellerLoading || c.submitting || !c.row.receiving_id || !template.subject.trim() || !template.description.trim()}
                title="Preview the seller-message step without filing a real ticket (uses #TEST)"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-dashed border-amber-300 bg-amber-50/70 px-3.5 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {c.testSellerLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Test next step →
              </button>
              <button
                type="button"
                onClick={c.submitInternal}
                disabled={c.submitting || c.archiveSubmitting || !c.row.receiving_id || !template.subject.trim() || !template.description.trim()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-sm transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {c.submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                {c.submitting ? 'Creating…' : 'Ticket & Seller MSG →'}
              </button>
            </>
          )
        ) : (
          <>
            <ProgressChip label={progressLabel} dotClass={progressDot} />
            {c.mode === 'link' && c.filedTicket && !c.linkCommitted ? (
              <button
                type="button"
                onClick={c.submitLink}
                disabled={c.linking || !c.row.receiving_id || !search.selectedTicket}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-sm transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {c.linking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {c.linking
                  ? 'Linking…'
                  : search.selectedTicket
                    ? `Link ticket #${search.selectedTicket.id} →`
                    : 'Link ticket'}
              </button>
            ) : null}
            {c.filedTicket ? (
              <button
                type="button"
                onClick={c.archiveToNas}
                disabled={c.archiveSubmitting || !c.row.receiving_id}
                title={`Back up this carton's photos to the NAS folder named ${c.filedTicket.number}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-blue-200 bg-white px-3.5 text-[11px] font-bold uppercase tracking-[0.14em] text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {c.archiveSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
                {c.archiveSubmitting ? 'Archiving…' : 'Archive to NAS'}
              </button>
            ) : null}
            <button
              type="button"
              disabled={!seller.sellerMessage.trim()}
              onClick={() => void seller.handleCopySellerMessage()}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-blue-200 bg-white px-3.5 text-[11px] font-bold uppercase tracking-[0.14em] text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Copy className="h-4 w-4" />
              Copy
            </button>
            <button
              type="button"
              onClick={() => void seller.finishSellerStep()}
              disabled={seller.aiLoading || (c.mode === 'link' && !c.linkCommitted)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 text-[11px] font-black uppercase tracking-[0.14em] text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {onSellerStep ? 'Finish seller msg' : 'Done'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
