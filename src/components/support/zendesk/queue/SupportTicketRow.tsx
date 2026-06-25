'use client';

import type { ZendeskTicket } from '@/lib/zendesk';
import { timeAgo } from '@/utils/_date';
import { cn } from '@/utils/_cn';
import { priorityBadge, statusBadge } from '../badges';

/** Zendesk status → a small dot hue (mirrors the badge colour scale). */
const STATUS_DOT: Record<string, string> = {
  new: 'bg-sky-500',
  open: 'bg-rose-500',
  pending: 'bg-amber-500',
  hold: 'bg-violet-500',
  solved: 'bg-emerald-500',
  closed: 'bg-gray-400',
};

/**
 * One ticket row in the sidebar queue. Title-first, status dot + meta eyebrow +
 * priority chip — the house one-row anatomy. Selection is background + ring only.
 */
export function SupportTicketRow({
  ticket,
  selected,
  onSelect,
}: {
  ticket: ZendeskTicket;
  selected: boolean;
  onSelect: () => void;
}) {
  const sb = statusBadge(ticket.status);
  const pb = priorityBadge(ticket.priority);
  const dot = STATUS_DOT[String(ticket.status)] ?? 'bg-gray-400';

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'block w-full px-3 py-2 text-left transition',
        selected ? 'bg-blue-50 ring-1 ring-inset ring-blue-400' : 'hover:bg-gray-50',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', dot)} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-gray-900">
          {ticket.subject || '(no subject)'}
        </span>
        {pb ? (
          <span className={cn('shrink-0 rounded px-1 py-0.5 text-[8.5px] font-black uppercase tracking-widest', pb.className)}>
            {pb.label}
          </span>
        ) : null}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 pl-4 text-[11px] text-gray-400">
        <span className="font-semibold uppercase tracking-wide">{sb.label}</span>
        <span>·</span>
        <span>#{ticket.id}</span>
        <span className="ml-auto">{timeAgo(ticket.updated_at)}</span>
      </div>
    </button>
  );
}
