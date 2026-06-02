'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ZendeskTicketList } from './ZendeskTicketList';
import type { StatusFilter, TicketListParams } from '@/hooks/useZendeskQueries';

/**
 * Stateful wrapper around <ZendeskTicketList>: owns search/status/page filter
 * state and drives the selected ticket through the URL (`?ticket=<id>`).
 *
 * Selection lives in the URL so the list (rendered in the /support contextual
 * sidebar) and the detail (rendered in the page body) stay in sync across the
 * two React trees, and so picking a ticket auto-closes the mobile sidebar
 * drawer (DashboardSidebar closes it on any searchParams change).
 */
export function ZendeskTicketListContainer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = Number(searchParams.get('ticket')) || null;

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

  const params = useMemo<TicketListParams>(
    () => ({ query: debounced, status, page }),
    [debounced, status, page],
  );

  const select = (id: number) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('ticket', String(id));
    router.push(`/support?${sp.toString()}`);
  };

  return (
    <ZendeskTicketList
      params={params}
      searchText={searchText}
      onSearchText={setSearchText}
      onStatus={setStatus}
      onPage={setPage}
      selectedId={selectedId}
      onSelect={select}
    />
  );
}
