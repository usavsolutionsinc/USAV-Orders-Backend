'use client';

import {
  isNotConfigured,
  useZendeskTickets,
  type StatusFilter,
  type TicketListParams,
} from '@/hooks/useZendeskQueries';
import { EmptyState } from '@/design-system/primitives';
import { SkeletonList } from '@/design-system/components/Skeletons';
import { ZendeskTicketRow } from './ZendeskTicketRow';

const STATUS_CHIPS: { value: StatusFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'hold', label: 'On-hold' },
  { value: 'solved', label: 'Solved' },
  { value: 'all', label: 'All' },
];

export function ZendeskTicketList({
  params,
  searchText,
  onSearchText,
  onStatus,
  onPage,
  selectedId,
  onSelect,
}: {
  params: TicketListParams;
  searchText: string;
  onSearchText: (v: string) => void;
  onStatus: (s: StatusFilter) => void;
  onPage: (p: number) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const { data, isLoading, error } = useZendeskTickets(params);
  const tickets = data?.tickets ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="shrink-0 border-b border-gray-100 p-3">
        <input
          type="text"
          value={searchText}
          onChange={(e) => onSearchText(e.target.value)}
          placeholder="Search tickets…"
          className="mb-2 block w-full rounded-lg border border-gray-200 px-3 py-2 text-label text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
        />
        <div className="flex flex-wrap gap-1">
          {STATUS_CHIPS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => onStatus(c.value)}
              className={`rounded-full px-2.5 py-1 text-micro font-black uppercase tracking-wider transition-colors ${
                params.status === c.value
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
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
          tickets.map((t) => (
            <ZendeskTicketRow
              key={t.id}
              ticket={t}
              selected={t.id === selectedId}
              onSelect={() => onSelect(t.id)}
            />
          ))
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-gray-100 px-3 py-2">
        <button
          type="button"
          disabled={!data?.previous_page && params.page <= 1}
          onClick={() => onPage(Math.max(1, params.page - 1))}
          className="rounded-lg border border-gray-200 px-3 py-1 text-micro font-bold uppercase tracking-wider text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
        >
          Prev
        </button>
        <span className="text-micro text-gray-400">
          {data?.count != null ? `${data.count} total` : ''}
        </span>
        <button
          type="button"
          disabled={!data?.next_page}
          onClick={() => onPage(params.page + 1)}
          className="rounded-lg border border-gray-200 px-3 py-1 text-micro font-bold uppercase tracking-wider text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
