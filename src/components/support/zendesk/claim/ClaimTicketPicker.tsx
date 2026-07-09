'use client';

import { useEffect, useState } from 'react';
import { Loader2, Search } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { useZendeskTickets } from '@/hooks/useZendeskQueries';
import { cn } from '@/utils/_cn';
import { priorityBadge, statusBadge } from '../badges';
import type { PickedTicket } from './claim-types';

/** Search + pick an existing ticket (Update mode). Reuses the support list hook. */
export function ClaimTicketPicker({
  ticket,
  onPick,
}: {
  ticket: PickedTicket | null;
  onPick: (t: PickedTicket | null) => void;
}) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const { data, isLoading } = useZendeskTickets({
    query: debounced,
    status: debounced ? 'all' : 'open',
    page: 1,
    perPage: 12,
  });
  const tickets = data?.tickets ?? [];

  if (ticket) {
    const sb = statusBadge(ticket.status);
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/60 px-3.5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-caption font-black text-blue-700">#{ticket.id}</span>
            <span className={cn('rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest', sb.className)}>
              {sb.label}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[13px] font-semibold text-text-default">
            {ticket.subject || 'Untitled ticket'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPick(null)}
          className="h-auto shrink-0 rounded-lg px-2 py-1 text-caption font-bold text-text-soft hover:bg-surface-card hover:text-text-default"
        >
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search tickets by subject or #id…"
          className="w-full rounded-xl border border-border-default bg-surface-card py-2.5 pl-9 pr-9 text-[13px] outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
        {isLoading ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-text-faint" />
        ) : null}
      </div>
      <div className="max-h-56 divide-y divide-border-hairline overflow-y-auto rounded-xl border border-border-soft">
        {tickets.length === 0 && !isLoading ? (
          <p className="px-3.5 py-6 text-center text-label text-text-faint">
            {debounced ? 'No matching tickets' : 'No open tickets'}
          </p>
        ) : (
          tickets.map((t) => {
            const sb = statusBadge(t.status as string);
            const pb = priorityBadge(t.priority as string);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() =>
                  onPick({
                    id: t.id,
                    subject: t.subject,
                    status: String(t.status),
                    priority: (t.priority as string) ?? null,
                  })
                }
                className="ds-raw-button flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-surface-hover"
              >
                <span className="text-caption font-black text-text-faint">#{t.id}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-default">
                  {t.subject || 'Untitled ticket'}
                </span>
                {pb ? (
                  <span className={cn('rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest', pb.className)}>
                    {pb.label}
                  </span>
                ) : null}
                <span className={cn('rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest', sb.className)}>
                  {sb.label}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
