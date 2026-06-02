'use client';

import type { ZendeskTicket } from '@/lib/zendesk';
import { formatDateTimePST } from '@/utils/date';
import { priorityBadge, statusBadge } from './badges';

export function ZendeskTicketRow({
  ticket,
  selected,
  onSelect,
}: {
  ticket: ZendeskTicket;
  selected: boolean;
  onSelect: () => void;
}) {
  const st = statusBadge(ticket.status);
  const pr = priorityBadge(ticket.priority);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`block w-full border-b border-gray-100 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 ${
        selected ? 'bg-blue-50/60' : ''
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`rounded px-1.5 py-0.5 text-micro font-black uppercase tracking-wider ${st.className}`}>
          {st.label}
        </span>
        {pr ? (
          <span className={`rounded px-1.5 py-0.5 text-micro font-black uppercase tracking-wider ${pr.className}`}>
            {pr.label}
          </span>
        ) : null}
        <span className="ml-auto text-micro font-bold text-gray-400">#{ticket.id}</span>
      </div>
      <p className="mt-1 truncate text-label font-bold text-gray-900">{ticket.subject || '(no subject)'}</p>
      <p className="mt-0.5 text-micro text-gray-400">{formatDateTimePST(ticket.updated_at)}</p>
    </button>
  );
}
