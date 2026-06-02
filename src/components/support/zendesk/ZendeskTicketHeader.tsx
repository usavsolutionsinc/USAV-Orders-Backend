'use client';

import type { ZendeskTicket } from '@/lib/zendesk';
import { useUpdateTicket, useZendeskAgents } from '@/hooks/useZendeskQueries';
import { zendeskTicketUrl } from '@/lib/zendesk-ticket-url';
import { ChevronLeft, ExternalLink } from '@/components/Icons';
import { ZendeskSelect, type SelectOption } from './ZendeskSelect';
import { STATUS_OPTIONS, PRIORITY_OPTIONS } from './badges';

const UNASSIGNED = 'unassigned';

export function ZendeskTicketHeader({
  ticket,
  onBack,
}: {
  ticket: ZendeskTicket;
  onBack?: () => void;
}) {
  const update = useUpdateTicket();
  const { data: agents = [] } = useZendeskAgents();

  const assigneeOptions: SelectOption[] = [
    { value: UNASSIGNED, label: 'Unassigned' },
    ...agents.map((a) => ({ value: String(a.id), label: a.name, sublabel: a.email ?? undefined })),
  ];

  const url = zendeskTicketUrl(ticket.id);

  return (
    <div className="shrink-0 border-b border-gray-100 bg-white px-4 py-3">
      <div className="flex items-start gap-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to list"
            className="-ml-1 mt-0.5 rounded-md p-1 text-gray-500 hover:bg-gray-100 lg:hidden"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-micro font-black uppercase tracking-widest text-gray-400">#{ticket.id}</p>
          <h2 className="mt-0.5 text-base font-extrabold tracking-tight text-gray-900">
            {ticket.subject || '(no subject)'}
          </h2>
        </div>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in Zendesk"
            className="mt-0.5 shrink-0 rounded-md border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ZendeskSelect
          value={String(ticket.status)}
          options={STATUS_OPTIONS}
          disabled={update.isPending}
          onChange={(status) =>
            update.mutate({ id: ticket.id, patch: { status: status as ZendeskTicket['status'] } })
          }
        />
        <ZendeskSelect
          value={ticket.priority ? String(ticket.priority) : null}
          options={PRIORITY_OPTIONS}
          placeholder="Priority"
          disabled={update.isPending}
          onChange={(priority) =>
            update.mutate({ id: ticket.id, patch: { priority: priority as ZendeskTicket['priority'] } })
          }
        />
        <ZendeskSelect
          value={ticket.assignee_id ? String(ticket.assignee_id) : UNASSIGNED}
          options={assigneeOptions}
          placeholder="Assignee"
          align="right"
          disabled={update.isPending}
          onChange={(v) =>
            update.mutate({ id: ticket.id, patch: { assignee_id: v === UNASSIGNED ? null : Number(v) } })
          }
        />
      </div>
    </div>
  );
}
