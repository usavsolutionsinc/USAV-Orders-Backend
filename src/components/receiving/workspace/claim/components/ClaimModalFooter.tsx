import { Copy, Loader2 } from '@/components/Icons';
import type { ReceivingClaimController } from '../hooks/useReceivingClaimController';

/** Contextual footer actions — varies by wizard step and mode. */
export function ClaimModalFooter({ c }: { c: ReceivingClaimController }) {
  const { template, search, seller } = c;
  const onInternalCreate = c.createStep === 'internal' && c.mode === 'create';

  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-t border-gray-100 bg-gray-50 px-5 py-3">
      <button
        type="button"
        onClick={c.onClose}
        disabled={c.submitting || c.linking || c.unlinking}
        className="inline-flex h-10 items-center rounded-xl border border-gray-200 bg-white px-4 text-caption font-bold uppercase tracking-widest text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
      >
        Cancel
      </button>

      {onInternalCreate ? (
        c.filedTicket ? (
          <button
            type="button"
            onClick={() => c.setCreateStep('seller')}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-rose-600 px-4 text-caption font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-rose-700"
          >
            Continue to seller →
          </button>
        ) : (
          <button
            type="button"
            onClick={c.submitInternal}
            disabled={c.submitting || !c.row.receiving_id || !template.subject.trim() || !template.description.trim()}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-rose-600 px-4 text-caption font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {c.submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {c.submitting ? 'Creating…' : 'Create Zendesk ticket →'}
          </button>
        )
      ) : (
        <>
          {c.mode === 'link' && c.filedTicket && !c.linkCommitted ? (
            <button
              type="button"
              onClick={c.submitLink}
              disabled={c.linking || !c.row.receiving_id || !search.selectedTicket}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-rose-600 px-4 text-caption font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {c.linking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {c.linking
                ? 'Linking…'
                : search.selectedTicket
                  ? `Link ticket #${search.selectedTicket.id} →`
                  : 'Link ticket'}
            </button>
          ) : null}
          <button
            type="button"
            disabled={!seller.sellerMessage.trim()}
            onClick={() => void seller.handleCopySellerMessage()}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-blue-200 bg-white px-4 text-caption font-bold uppercase tracking-widest text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Copy className="h-4 w-4" />
            Copy
          </button>
          <button
            type="button"
            onClick={() => void seller.finishSellerStep()}
            disabled={seller.aiLoading || (c.mode === 'link' && !c.linkCommitted)}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-caption font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Done
          </button>
        </>
      )}
    </div>
  );
}
