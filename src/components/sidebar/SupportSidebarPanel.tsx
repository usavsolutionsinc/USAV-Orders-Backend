'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { ZendeskTicketListContainer } from '@/components/support/zendesk/ZendeskTicketListContainer';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { RefreshCw } from '@/components/Icons';
import { SIDEBAR_GUTTER } from '@/components/layout/header-shell';

/**
 * Contextual sidebar for /support: the Zendesk ticket queue lives here (search,
 * status filter, rows, pagination). Selecting a ticket sets `?ticket=<id>`,
 * which the page body (SupportWorkspace) renders as the conversation detail.
 * One sidebar — no separate ticket-list column.
 */
export function SupportSidebarPanel() {
  const { has, isLoaded } = useAuth();
  const queryClient = useQueryClient();

  // Keep honoring the legacy 'support-refresh' event (other surfaces may fire it).
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className={`flex shrink-0 items-center justify-between border-b border-gray-100 ${SIDEBAR_GUTTER} py-2.5`}>
        <p className={`${sectionLabel} text-rose-600`}>Customer Support</p>
        <button
          type="button"
          onClick={() => void queryClient.invalidateQueries({ queryKey: ['zendesk'] })}
          aria-label="Refresh tickets"
          title="Refresh tickets"
          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <ZendeskTicketListContainer />
      </div>
    </div>
  );
}
