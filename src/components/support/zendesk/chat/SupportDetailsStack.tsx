'use client';

import { useRef, useState } from 'react';
import { AnchoredLayer } from '@/design-system';
import type { ZendeskTicket } from '@/lib/zendesk';
import { useUpdateTicket } from '@/hooks/useZendeskQueries';
import { formatDateTimePST } from '@/utils/date';
import { cn } from '@/utils/_cn';
import { Layers } from '@/components/Icons';
import { TagInput } from '../TagInput';
import { priorityBadge, statusBadge } from '../badges';
import { requesterFrom } from './support-chat-utils';

type Tab = 'details' | 'tags';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</p>
      <div className="text-[12px] text-gray-700">{children}</div>
    </div>
  );
}

/**
 * The support "details stack" — a small tabbed popover anchored to a header
 * button (sits just left of the open-in-Zendesk link). Holds the secondary
 * ticket detail that doesn't belong in the always-visible header: a Details tab
 * (requester, id, status/priority, timestamps) and a Tags tab (the ONLY place
 * ticket tags are shown/edited).
 */
export function SupportDetailsStack({ ticket }: { ticket: ZendeskTicket }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('details');
  const anchorRef = useRef<HTMLButtonElement>(null);
  const update = useUpdateTicket();

  const requester = requesterFrom(ticket);
  const sb = statusBadge(ticket.status);
  const pb = priorityBadge(ticket.priority ?? null);
  const tagCount = ticket.tags?.length ?? 0;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Ticket details"
        aria-expanded={open}
        title="Ticket details"
        className={cn(
          'relative mt-0.5 shrink-0 rounded-lg border p-1.5 transition',
          open
            ? 'border-blue-300 bg-blue-50 text-blue-700'
            : 'border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700',
        )}
      >
        <Layers className="h-3.5 w-3.5" />
        {tagCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-gray-700 px-1 text-[8px] font-black text-white">
            {tagCount}
          </span>
        ) : null}
      </button>

      <AnchoredLayer open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="bottom-end" gap={4}>
        <div className="w-72 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          {/* Tab strip */}
          <div className="flex border-b border-gray-100">
            {(['details', 'tags'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  'flex-1 px-3 py-2 text-[10px] font-black uppercase tracking-widest transition',
                  tab === t
                    ? 'border-b-2 border-blue-500 text-blue-700'
                    : 'text-gray-400 hover:text-gray-600',
                )}
              >
                {t === 'details' ? 'Details' : `Tags${tagCount ? ` · ${tagCount}` : ''}`}
              </button>
            ))}
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-3">
            {tab === 'details' ? (
              <div className="space-y-3">
                <Field label="Requester">
                  <span className="font-semibold text-gray-800">{requester.name || 'Requester'}</span>
                  {requester.email ? <span className="block text-gray-500">{requester.email}</span> : null}
                </Field>
                <Field label="Ticket">#{ticket.id}</Field>
                <div className="flex gap-6">
                  <Field label="Status">
                    <span className={cn('inline-block rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest', sb.className)}>
                      {sb.label}
                    </span>
                  </Field>
                  <Field label="Priority">
                    {pb ? (
                      <span className={cn('inline-block rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest', pb.className)}>
                        {pb.label}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </Field>
                </div>
                <Field label="Created">{formatDateTimePST(ticket.created_at)}</Field>
                <Field label="Updated">{formatDateTimePST(ticket.updated_at)}</Field>
              </div>
            ) : (
              <div className="space-y-2">
                <TagInput
                  tags={ticket.tags ?? []}
                  disabled={update.isPending}
                  placeholder="Add a tag…"
                  onChange={(tags) => update.mutate({ id: ticket.id, patch: { tags } })}
                />
                <p className="text-[10px] text-gray-400">Tags sync to Zendesk.</p>
              </div>
            )}
          </div>
        </div>
      </AnchoredLayer>
    </>
  );
}
