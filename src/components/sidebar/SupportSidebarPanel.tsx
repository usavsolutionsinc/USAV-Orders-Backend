'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { SupportTicketQueue } from '@/components/support/zendesk/queue/SupportTicketQueue';

/**
 * Contextual sidebar for /support: the Zendesk ticket queue (search, status
 * filter, sort, recents, list, pagination). Selecting a ticket sets
 * `?ticket=<id>`, which the page body (SupportWorkspace) renders as the chat
 * detail. No "Customer Support" heading — the master nav already titles the page.
 */
export function SupportSidebarPanel() {
  const { has, isLoaded } = useAuth();
  const queryClient = useQueryClient();

  // Other surfaces still fire 'support-refresh' to invalidate the ticket caches.
  useEffect(() => {
    const onRefresh = () => void queryClient.invalidateQueries({ queryKey: ['zendesk'] });
    window.addEventListener('support-refresh', onRefresh);
    return () => window.removeEventListener('support-refresh', onRefresh);
  }, [queryClient]);

  if (isLoaded && !has('integrations.zendesk')) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-caption font-semibold text-gray-500">
        Requires the “Manage Zendesk tickets” permission.
      </div>
    );
  }

  return <SupportTicketQueue />;
}
