'use client';

import { ExternalLink } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
import { WorkspaceCard } from '@/design-system/components';
import { ClaimTicketReply } from '@/components/receiving/workspace/claim/components/ClaimTicketReply';
import { useClaimTicketReply } from '@/components/receiving/workspace/claim/hooks/useClaimTicketReply';
import type { FiledTicket } from '@/components/receiving/workspace/claim/claim-types';

/**
 * Comment on the line's linked Zendesk ticket straight from the testing page —
 * reuses the shared {@link ClaimTicketReply} composer (internal note by default,
 * or a public reply that emails the customer) driven by {@link useClaimTicketReply},
 * which posts to the same receiving-scoped thread route the claim modal uses.
 *
 * Rendered only when the line has a Zendesk-native linked ticket; the linkage
 * itself is shown by the carton header's ticket chip.
 */
export function TestingTicketReplyCard({
  ticketId,
  ticketNumber,
  ticketUrl,
}: {
  /** Zendesk-native ticket id (providerTicketId) — the thread route's key. */
  ticketId: number;
  /** Display number, e.g. "#9395". */
  ticketNumber: string;
  /** Deep link to the ticket in Zendesk, if known. */
  ticketUrl?: string | null;
}) {
  const reply = useClaimTicketReply({ open: true, ticketId });
  const filedTicket: FiledTicket = { id: ticketId, number: ticketNumber, url: ticketUrl ?? null };

  return (
    <WorkspaceCard
      label="Zendesk ticket"
      bodyClassName="p-4"
      actions={
        ticketUrl ? (
          <HoverTooltip label="Open ticket in Zendesk" asChild>
            <IconButton
              icon={<ExternalLink className="h-4 w-4" />}
              ariaLabel="Open ticket in Zendesk"
              tone="accent"
              onClick={() => window.open(ticketUrl, '_blank', 'noopener,noreferrer')}
            />
          </HoverTooltip>
        ) : undefined
      }
    >
      <ClaimTicketReply reply={reply} filedTicket={filedTicket} />
    </WorkspaceCard>
  );
}
