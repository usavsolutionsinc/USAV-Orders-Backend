import { Loader2, MessageSquare, Sparkles } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { Button } from '@/design-system/primitives';
import type { FiledTicket } from '../claim-types';
import type { UseClaimSellerMessage } from '../hooks/useClaimSellerMessage';
import { SellerMessageSkeleton } from './SellerMessageSkeleton';

interface Props {
  seller: UseClaimSellerMessage;
  filedTicket: FiledTicket | null;
}

/** Blue seller-message editor with AI redraft, shown on the seller step. */
export function ClaimSellerMessagePanel({ seller, filedTicket }: Props) {
  const { sellerMessage, setSellerMessage, aiModel, aiLoading, draftSellerMessage } = seller;
  const draftDisabled = aiLoading || !filedTicket || filedTicket.number === 'pending';

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquare className="h-4 w-4 shrink-0 text-blue-600" />
          <div>
            <p className="text-micro font-black uppercase tracking-[0.14em] text-blue-700">Seller message</p>
            {aiModel ? <p className="text-micro font-semibold text-blue-600/70">Drafted by {aiModel}</p> : null}
          </div>
        </div>
        <HoverTooltip label="Regenerate seller message with AI" asChild>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => filedTicket && void draftSellerMessage(filedTicket)}
            disabled={draftDisabled}
            icon={aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            className="h-7 border border-blue-200 bg-surface-card text-blue-700 hover:bg-blue-100"
          >
            {aiLoading ? 'Drafting…' : 'Redraft'}
          </Button>
        </HoverTooltip>
      </div>
      {aiLoading && !sellerMessage ? (
        <SellerMessageSkeleton />
      ) : (
        <textarea
          value={sellerMessage}
          onChange={(e) => setSellerMessage(e.target.value)}
          rows={12}
          placeholder="Seller-facing message will appear here…"
          className="block w-full resize-y rounded-lg border border-blue-100 bg-surface-card px-3 py-2 text-caption font-medium leading-snug text-text-default outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
        />
      )}
      <p className="mt-1.5 text-micro font-medium text-blue-700/70">
        Paste into eBay or the marketplace seller. Plain text only — no links. Includes your Zendesk
        case # as a reference.
      </p>
    </div>
  );
}
