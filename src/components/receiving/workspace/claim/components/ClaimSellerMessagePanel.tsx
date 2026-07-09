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

/** Seller-message editor with AI redraft — flat linear section. */
export function ClaimSellerMessagePanel({ seller, filedTicket }: Props) {
  const { sellerMessage, setSellerMessage, aiModel, aiLoading, draftSellerMessage } = seller;
  const draftDisabled = aiLoading || !filedTicket || filedTicket.number === 'pending';

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-text-faint" />
          <div>
            <p className="text-micro font-black uppercase tracking-[0.14em] text-text-soft">
              Seller message
            </p>
            {aiModel ? (
              <p className="text-micro font-semibold text-text-faint">Drafted by {aiModel}</p>
            ) : null}
          </div>
        </div>
        <HoverTooltip label="Regenerate seller message with AI" asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => filedTicket && void draftSellerMessage(filedTicket)}
            disabled={draftDisabled}
            icon={aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
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
          className="block w-full resize-y rounded-lg border border-border-default bg-surface-card px-3 py-2 text-caption font-medium leading-snug text-text-default outline-none focus:border-border-emphasis focus:ring-2 focus:ring-text-soft/20"
        />
      )}
      <p className="text-micro font-medium text-text-faint">
        Paste into eBay or the marketplace seller. Plain text — includes case # as reference.
      </p>
    </section>
  );
}
