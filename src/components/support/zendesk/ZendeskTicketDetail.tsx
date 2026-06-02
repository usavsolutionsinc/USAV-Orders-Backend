'use client';

import { isNotConfigured, useZendeskTicket } from '@/hooks/useZendeskQueries';
import { EmptyState, Spinner } from '@/design-system/primitives';
import { ZendeskTicketHeader } from './ZendeskTicketHeader';
import { ZendeskCommentThread } from './ZendeskCommentThread';
import { ZendeskCommentComposer } from './ZendeskCommentComposer';
import { ZendeskTicketPhotos } from './ZendeskTicketPhotos';

export function ZendeskTicketDetail({
  ticketId,
  onBack,
}: {
  ticketId: number;
  onBack?: () => void;
}) {
  const { data: ticket, isLoading, error } = useZendeskTicket(ticketId);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          title={isNotConfigured(error) ? 'Zendesk isn’t configured' : 'Couldn’t load ticket'}
          description={
            isNotConfigured(error)
              ? 'Set the Zendesk API credentials to use the console.'
              : 'Try selecting the ticket again.'
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ZendeskTicketHeader ticket={ticket} onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ZendeskCommentThread ticketId={ticketId} requesterId={ticket.requester_id} />
        <ZendeskTicketPhotos ticketId={ticketId} />
      </div>
      <ZendeskCommentComposer ticketId={ticketId} />
    </div>
  );
}
