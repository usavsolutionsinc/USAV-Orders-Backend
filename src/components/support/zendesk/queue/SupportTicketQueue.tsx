'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Clock, History, RefreshCw } from '@/components/Icons';
import { Button, EmptyState, IconButton } from '@/design-system/primitives';
import { SkeletonList } from '@/design-system/components/Skeletons';
import { SearchBar } from '@/components/ui/SearchBar';
import { SidebarNavOverlaySlider } from '@/components/sidebar/SidebarNavOverlaySlider';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { TICKET_STATUS_ITEMS } from '@/components/sidebar/support/support-sidebar-shared';
import {
  isNotConfigured,
  useZendeskTickets,
  type StatusFilter,
  type TicketListParams,
} from '@/hooks/useZendeskQueries';
import { useRecentTickets } from '@/hooks/useRecentTickets';
import { cn } from '@/utils/_cn';
import { ZendeskSelect } from '../ZendeskSelect';
import { SupportTicketRow } from './SupportTicketRow';

type SortKey = 'recent' | 'oldest' | 'priority';
const SORTS: Record<SortKey, { sortBy: TicketListParams['sortBy']; sortOrder: TicketListParams['sortOrder']; label: string }> = {
  recent: { sortBy: 'updated_at', sortOrder: 'desc', label: 'Recent' },
  oldest: { sortBy: 'created_at', sortOrder: 'asc', label: 'Oldest' },
  priority: { sortBy: 'priority', sortOrder: 'desc', label: 'Priority' },
};
const SORT_OPTIONS = (Object.keys(SORTS) as SortKey[]).map((k) => ({ value: k, label: SORTS[k].label }));

interface SelectableTicket {
  id: number;
  subject: string | null;
  status: string;
  priority: string | null;
}

/**
 * The support queue (sidebar + mobile fallback): shared `SearchBar` +
 * `HorizontalButtonSlider` status filter + sort, a "Recently opened" group, the
 * ticket list, and pagination. Selection drives `?ticket=<id>`; the chat detail
 * reads it.
 */
export function SupportTicketQueue({ modeToggle = null }: { modeToggle?: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const selectedId = Number(searchParams.get('ticket')) || null;
  const { recents, push } = useRecentTickets();

  const [status, setStatus] = useState<StatusFilter>('open');
  const [sort, setSort] = useState<SortKey>('recent');
  const [page, setPage] = useState(1);
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const h = setTimeout(() => setDebounced(text.trim()), 300);
    return () => clearTimeout(h);
  }, [text]);
  useEffect(() => {
    setPage(1);
  }, [status, debounced, sort]);

  const params = useMemo<TicketListParams>(
    () => ({
      query: debounced,
      status,
      page,
      perPage: 20,
      sortBy: SORTS[sort].sortBy,
      sortOrder: SORTS[sort].sortOrder,
    }),
    [debounced, status, page, sort],
  );

  const { data, isLoading, isFetching, error } = useZendeskTickets(params);
  const tickets = data?.tickets ?? [];

  const select = (t: SelectableTicket) => {
    push({ id: t.id, subject: t.subject, status: t.status, priority: t.priority });
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('ticket', String(t.id));
    router.push(`/support?${sp.toString()}`);
  };

  const showRecents = recents.length > 0 && !debounced;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* Search — shared SearchBar primitive */}
      <div className="shrink-0 px-2 pt-2">
        <SearchBar
          value={text}
          onChange={setText}
          onClear={() => setText('')}
          placeholder="Search tickets…"
          variant="blue"
          size="compact"
          isSearching={isFetching && !isLoading}
        />
      </div>

      <div className="flex shrink-0 items-center justify-between px-2 py-2">
        <ZendeskSelect value={sort} options={SORT_OPTIONS} onChange={(v) => setSort(v as SortKey)} />
        <HoverTooltip label="Refresh tickets" asChild>
          <IconButton
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['zendesk'] })}
            ariaLabel="Refresh tickets"
            className="rounded-md p-1.5 hover:bg-gray-100"
          />
        </HoverTooltip>
      </div>

      {/* Body — mode + status pills float over the scrolling ticket list. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {modeToggle}
        <SidebarNavOverlaySlider
          items={TICKET_STATUS_ITEMS}
          value={status}
          onChange={(id) => setStatus(id as StatusFilter)}
          aria-label="Ticket status"
        />
        {showRecents ? (
          <div className="border-b border-gray-100 pb-1.5">
            <p className="flex items-center gap-1 px-3 pb-1 pt-2 text-micro font-black uppercase tracking-widest text-gray-400">
              <History className="h-3 w-3" /> Recently opened
            </p>
            {recents.map((r) => (
              // ds-raw-button: text-left master-detail recents row (clock + subject + #id, selection ring), not a standard action Button
              <button
                key={`recent-${r.id}`}
                type="button"
                onClick={() => select(r)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left transition',
                  r.id === selectedId ? 'bg-blue-50 ring-1 ring-inset ring-blue-400' : 'hover:bg-gray-50',
                )}
              >
                <Clock className="h-3 w-3 shrink-0 text-gray-300" />
                <span className="min-w-0 flex-1 truncate text-label font-semibold text-gray-700">
                  {r.subject || `Ticket #${r.id}`}
                </span>
                <span className="shrink-0 text-micro font-bold text-gray-300">#{r.id}</span>
              </button>
            ))}
          </div>
        ) : null}

        {isLoading ? (
          <SkeletonList count={6} />
        ) : error ? (
          <div className="p-6">
            <EmptyState
              title={isNotConfigured(error) ? 'Zendesk isn’t configured' : 'Couldn’t load tickets'}
              description={
                isNotConfigured(error)
                  ? 'Set the Zendesk API credentials to use the console.'
                  : 'Please try again.'
              }
            />
          </div>
        ) : tickets.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No tickets match" description="Try a different filter or search." />
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {showRecents ? (
              <p className="px-3 pb-1 pt-2.5 text-micro font-black uppercase tracking-widest text-gray-400">
                All tickets
              </p>
            ) : null}
            {tickets.map((t) => (
              <SupportTicketRow
                key={t.id}
                ticket={t}
                selected={t.id === selectedId}
                onSelect={() =>
                  select({
                    id: t.id,
                    subject: t.subject,
                    status: String(t.status),
                    priority: (t.priority as string) ?? null,
                  })
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex shrink-0 items-center justify-between border-t border-gray-100 px-3 py-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={!data?.previous_page && page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Prev
        </Button>
        <span className="text-micro font-semibold text-gray-400">
          {data?.count != null ? `${data.count} total` : ''}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={!data?.next_page}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
