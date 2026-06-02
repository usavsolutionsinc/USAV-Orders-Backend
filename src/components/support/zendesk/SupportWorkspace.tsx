'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { EmptyState } from '@/design-system/primitives';
import { ZendeskTicketList } from './ZendeskTicketList';
import { ZendeskTicketDetail } from './ZendeskTicketDetail';
import type { StatusFilter, TicketListParams } from '@/hooks/useZendeskQueries';

/**
 * Native Zendesk ticket console. Master–detail: ticket list (search + status
 * filter + pagination) on the left, selected ticket (thread + reply/notes +
 * status/priority/assignee editors + linked photos) on the right. On mobile the
 * list and detail swap full-screen.
 */
export function SupportWorkspace() {
  const { has, isLoaded } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [status, setStatus] = useState<StatusFilter>('open');
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const h = setTimeout(() => setDebounced(searchText.trim()), 300);
    return () => clearTimeout(h);
  }, [searchText]);

  // A new filter or search starts over at page 1.
  useEffect(() => {
    setPage(1);
  }, [status, debounced]);

  // The sidebar "Refresh Queue" button dispatches this event.
  useEffect(() => {
    const onRefresh = () => void queryClient.invalidateQueries({ queryKey: ['zendesk'] });
    window.addEventListener('support-refresh', onRefresh);
    return () => window.removeEventListener('support-refresh', onRefresh);
  }, [queryClient]);

  const params = useMemo<TicketListParams>(
    () => ({ query: debounced, status, page }),
    [debounced, status, page],
  );

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

  return (
    <div className="flex h-full min-h-0 w-full bg-gray-50">
      <div
        className={`${
          selectedId != null ? 'hidden lg:flex' : 'flex'
        } h-full w-full flex-col border-r border-gray-200 lg:w-[380px] lg:shrink-0`}
      >
        <ZendeskTicketList
          params={params}
          searchText={searchText}
          onSearchText={setSearchText}
          onStatus={setStatus}
          onPage={setPage}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>

      <div
        className={`${
          selectedId != null ? 'flex' : 'hidden lg:flex'
        } h-full min-h-0 w-full flex-col`}
      >
        {selectedId != null ? (
          <ZendeskTicketDetail ticketId={selectedId} onBack={() => setSelectedId(null)} />
        ) : (
          <div className="hidden h-full items-center justify-center lg:flex">
            <EmptyState
              title="Select a ticket"
              description="Choose a ticket from the list to view the conversation."
            />
          </div>
        )}
      </div>
    </div>
  );
}
