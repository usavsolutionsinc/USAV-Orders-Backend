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
import { Check, ChevronLeft, ExternalLink, X } from '@/components/Icons';
import { IconButton } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { cn } from '@/utils/_cn';
import { ZendeskSelect, type SelectOption } from '../ZendeskSelect';
import { PRIORITY_OPTIONS, STATUS_OPTIONS, statusBadge } from '../badges';
import { SupportDetailsStack } from './SupportDetailsStack';
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

  // Inline title (subject) edit — click the title, confirm with the checkmark.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const startEditTitle = () => {
    setTitleDraft(ticket.subject || '');
    setEditingTitle(true);
  };
  const saveTitle = () => {
    const next = titleDraft.trim();
    if (next && next !== (ticket.subject || '')) update.mutate({ id: ticket.id, patch: { subject: next } });
    setEditingTitle(false);
  };

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
    <div className="shrink-0 border-b border-border-hairline bg-surface-card px-5 py-3.5">
      <div className="flex items-start gap-3">
        {onBack ? (
          <IconButton
            icon={<ChevronLeft className="h-4 w-4" />}
            onClick={onBack}
            ariaLabel="Back to list"
            className="-ml-1 mt-0.5 rounded-md p-1 hover:bg-surface-sunken lg:hidden"
          />
        ) : null}
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-label font-black text-text-soft">
          {initials(reqName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {editingTitle ? (
              <>
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      saveTitle();
                    } else if (e.key === 'Escape') {
                      setEditingTitle(false);
                    }
                  }}
                  className="min-w-0 flex-1 rounded-md border border-blue-300 bg-surface-card px-2 py-0.5 text-[15px] font-bold tracking-tight text-text-default outline-none focus:ring-2 focus:ring-blue-100"
                />
                <HoverTooltip label="Save title" asChild>
                  <IconButton
                    icon={<Check className="h-3.5 w-3.5 text-white" />}
                    onClick={saveTitle}
                    disabled={update.isPending}
                    ariaLabel="Save title"
                    className="shrink-0 rounded-md bg-blue-600 p-1 hover:bg-blue-700"
                  />
                </HoverTooltip>
                <HoverTooltip label="Cancel" asChild>
                  <IconButton
                    icon={<X className="h-3.5 w-3.5" />}
                    onClick={() => setEditingTitle(false)}
                    ariaLabel="Cancel"
                    className="shrink-0 rounded-md p-1 hover:bg-surface-sunken"
                  />
                </HoverTooltip>
              </>
            ) : (
              <>
                <HoverTooltip label="Click to edit title" asChild>
                  {/* ds-raw-button: text-left inline-editable title (truncating subject), not a standard action Button */}
                  <button
                    type="button"
                    onClick={startEditTitle}
                    aria-label="Click to edit title"
                    className="min-w-0 truncate text-left text-[15px] font-bold tracking-tight text-text-default transition hover:text-blue-700"
                  >
                    {ticket.subject || '(no subject)'}
                  </button>
                </HoverTooltip>
                <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest', sb.className)}>
                  {sb.label}
                </span>
              </>
            )}
          </div>
          <p className="mt-0.5 truncate text-label text-text-soft">
            <span className="font-semibold text-text-muted">{reqName}</span>
            {requester.email && requester.name ? <span className="text-text-faint"> · {requester.email}</span> : null}
            <span className="text-text-faint"> · #{ticket.id}</span>
          </p>
        </div>
        {/* Details stack — secondary detail + tags, just left of the Zendesk link. */}
        <SupportDetailsStack ticket={ticket} />
        {url ? (
          <HoverTooltip label="Open in Zendesk" asChild>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open in Zendesk"
              className="mt-0.5 shrink-0 rounded-lg border border-border-soft p-1.5 text-text-soft transition hover:bg-surface-hover hover:text-text-muted"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </HoverTooltip>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* Zendesk ticket fields — these write back to Zendesk. */}
        <div className="flex items-center gap-2">
          <span className="text-eyebrow font-black uppercase tracking-widest text-text-faint">Zendesk</span>
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
        <div className="flex items-center gap-2 border-l border-border-soft pl-3">
          <span className="text-eyebrow font-black uppercase tracking-widest text-text-faint">Follow-up</span>
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
