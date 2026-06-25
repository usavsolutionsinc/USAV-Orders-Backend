'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyState } from '@/design-system/primitives';
import { SupportTicketDetail } from './chat/SupportTicketDetail';
import { SupportTicketQueue } from './queue/SupportTicketQueue';

/**
 * /support page body. The ticket queue lives in the contextual sidebar
 * (SupportSidebarPanel) on md+; this body shows the selected ticket's
 * conversation. Selection is driven by `?ticket=<id>` in the URL.
 *
 * Below md the contextual sidebar isn't shown, so the list falls back to
 * rendering here (full-screen list ⇄ detail swap).
 */
export function SupportWorkspace() {
  const { has, isLoaded } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = Number(searchParams.get('ticket')) || null;

  if (isLoaded && !has('integrations.zendesk')) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          title="No access to Support"
          description="You need the “Manage Zendesk tickets” permission to view the support console."
        />
      </div>
    );
  }

  const clearSelection = () => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete('ticket');
    const qs = sp.toString();
    router.push(qs ? `/support?${qs}` : '/support');
  };

  return (
    <div className="flex h-full min-h-0 w-full bg-gray-50">
      {/* Mobile/tablet (<md): no contextual sidebar, so the queue lives here. */}
      {!selectedId ? (
        <div className="flex h-full w-full flex-col border-r border-gray-200 bg-white md:hidden">
          <SupportTicketQueue />
        </div>
      ) : null}

      {/* Detail: full page on md+, full screen on mobile once a ticket is picked. */}
      <div className={`${selectedId ? 'flex' : 'hidden md:flex'} h-full min-h-0 w-full flex-col`}>
        {selectedId != null ? (
          <SupportTicketDetail ticketId={selectedId} onBack={clearSelection} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              title="Select a ticket"
              description="Choose a ticket from the queue to view the conversation."
            />
          </div>
        )}
      </div>
    </div>
  );
}
