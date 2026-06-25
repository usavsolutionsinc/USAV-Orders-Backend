'use client';

import { useEffect, useState } from 'react';
import type { ZendeskTicket } from '@/lib/zendesk';
import {
  useAssignTicket,
  useTicketAssignment,
  useUpdateTicket,
  useZendeskAgents,
} from '@/hooks/useZendeskQueries';
import { getActiveStaff, type StaffMember } from '@/lib/staffCache';
import { zendeskTicketUrl } from '@/lib/zendesk-ticket-url';
import { ChevronLeft, ExternalLink } from '@/components/Icons';
import { cn } from '@/utils/_cn';
import { ZendeskSelect, type SelectOption } from '../ZendeskSelect';
import { PRIORITY_OPTIONS, STATUS_OPTIONS, statusBadge } from '../badges';
import { initials, requesterFrom } from './support-chat-utils';

const UNASSIGNED = 'unassigned';

/**
 * Chat header. Two separate concerns, deliberately split:
 *   - the ZENDESK row (status / priority / Zendesk assignee) updates the ticket
 *     in Zendesk;
 *   - the FOLLOW-UP row assigns the ticket to one of OUR staff, dropping a
 *     notification into their inbox bell — it never touches Zendesk.
 */
export function SupportChatHeader({ ticket, onBack }: { ticket: ZendeskTicket; onBack?: () => void }) {
  const update = useUpdateTicket();
  const assign = useAssignTicket();
  const { data: agents = [] } = useZendeskAgents();
  const { data: assignment } = useTicketAssignment(ticket.id);
  const url = zendeskTicketUrl(ticket.id);
  const requester = requesterFrom(ticket);
  const reqName = requester.name || requester.email || 'Requester';
  const sb = statusBadge(ticket.status);

  // Our own staff roster for the in-website follow-up assignment.
  const [staff, setStaff] = useState<StaffMember[]>([]);
  useEffect(() => {
    let alive = true;
    getActiveStaff()
      .then((list) => alive && setStaff(list))
      .catch(() => {
        /* staffCache swallows; leave empty */
      });
    return () => {
      alive = false;
    };
  }, []);

  const assigneeOptions: SelectOption[] = [
    { value: UNASSIGNED, label: 'Unassigned' },
    ...agents.map((a) => ({ value: String(a.id), label: a.name, sublabel: a.email ?? undefined })),
  ];

  const staffOptions: SelectOption[] = [
    { value: UNASSIGNED, label: 'Unassigned' },
    ...staff.map((s) => ({ value: String(s.id), label: s.name })),
  ];

  return (
    <div className="shrink-0 border-b border-gray-100 bg-white px-5 py-3.5">
      <div className="flex items-start gap-3">
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
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[12px] font-black text-gray-500">
          {initials(reqName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[15px] font-bold tracking-tight text-gray-900">
              {ticket.subject || '(no subject)'}
            </h2>
            <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest', sb.className)}>
              {sb.label}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-gray-500">
            <span className="font-semibold text-gray-600">{reqName}</span>
            {requester.email && requester.name ? <span className="text-gray-400"> · {requester.email}</span> : null}
            <span className="text-gray-300"> · #{ticket.id}</span>
          </p>
        </div>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in Zendesk"
            className="mt-0.5 shrink-0 rounded-lg border border-gray-200 p-1.5 text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* Zendesk ticket fields — these write back to Zendesk. */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Zendesk</span>
          <ZendeskSelect
            value={String(ticket.status)}
            options={STATUS_OPTIONS}
            disabled={update.isPending}
            onChange={(status) => update.mutate({ id: ticket.id, patch: { status: status as ZendeskTicket['status'] } })}
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
            placeholder="Agent"
            disabled={update.isPending}
            onChange={(v) => update.mutate({ id: ticket.id, patch: { assignee_id: v === UNASSIGNED ? null : Number(v) } })}
          />
        </div>

        {/* In-website follow-up — assigning notifies that staffer's inbox bell. */}
        <div className="flex items-center gap-2 border-l border-gray-200 pl-3">
          <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Follow-up</span>
          <ZendeskSelect
            value={assignment ? String(assignment.assignedStaffId) : UNASSIGNED}
            options={staffOptions}
            placeholder="Assign staff"
            align="right"
            disabled={assign.isPending}
            onChange={(v) => {
              const staffId = v === UNASSIGNED ? null : Number(v);
              const staffName = staffId == null ? undefined : staff.find((s) => s.id === staffId)?.name;
              assign.mutate({ id: ticket.id, staffId, staffName });
            }}
          />
        </div>
      </div>
    </div>
  );
}
