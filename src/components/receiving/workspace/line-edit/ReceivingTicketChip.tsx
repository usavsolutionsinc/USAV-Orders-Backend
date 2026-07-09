'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Clock, ExternalLink, Loader2, MessageSquare, Unlink } from '@/components/Icons';
import { toast } from '@/lib/toast';
import { cn } from '@/utils/_cn';
import { formatDateTimePST } from '@/utils/date';
import { AnchoredLayer } from '@/design-system/primitives/AnchoredLayer';
import { Button } from '@/design-system/primitives';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IdentityLinkChip } from './IdentityLinkChip';

/** Numeric Zendesk id parsed out of a stored "#1234" / "1234" / ticket URL. */
function parseTicketId(raw: string): number | null {
  const fromUrl = raw.match(/tickets\/(\d+)/);
  const digits = (fromUrl ? fromUrl[1] : raw.replace(/^#/, '')).match(/\d+/);
  if (!digits) return null;
  const n = Number(digits[0]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

interface ThreadComment {
  id: number;
  body: string;
  public: boolean;
  createdAt: string;
  authorId: number;
}

interface ThreadResult {
  ticket: {
    id: number;
    subject: string | null;
    status: string;
    priority: string | null;
    url: string | null;
  };
  comments: ThreadComment[];
}

const threadKey = (ticketId: number) => ['receiving', 'ticket-thread', ticketId] as const;

function useTicketThread(ticketId: number | null, open: boolean) {
  return useQuery<ThreadResult, Error>({
    queryKey: threadKey(ticketId ?? 0),
    queryFn: async () => {
      const res = await fetch(`/api/receiving/zendesk-claim/thread?ticketId=${ticketId}`, {
        cache: 'no-store',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      return { ticket: data.ticket, comments: data.comments } as ThreadResult;
    },
    // Only fetch once the popover is open — the chip alone never hits Zendesk.
    enabled: open && !!ticketId,
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Filed-ticket chip for the carton identity row. Renders the same
 * {@link IdentityLinkChip} primitive as PO#/tracking (orange `#` tone): chip
 * click copies, hover menu offers Open then Edit. The Edit row opens an
 * anchored popover showing the ticket's history (live Zendesk comments) with
 * an Unlink action — instead of re-opening the full claim modal.
 */
export function ReceivingTicketChip({
  value,
  display,
  openHref,
  providerTicketId,
  receivingId,
  lineId,
  onUnlinked,
}: {
  /** Copy value — internal ticket label (#42). */
  value: string;
  /** Short label shown in the chip (internal ticket id). */
  display: string;
  /** Zendesk deep link for the chip's external-link button. */
  openHref: string | null | undefined;
  /** Provider-native id (Zendesk) for thread/unlink/archive APIs. */
  providerTicketId?: number | null;
  receivingId: number | null;
  /** Line the ticket is linked to (RECEIVING_LINE entity); null → carton. */
  lineId: number | null;
  /** Called after a successful unlink so the parent can clear its ticket state. */
  onUnlinked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const zendeskTicketId = providerTicketId ?? parseTicketId(value);

  return (
    <div ref={anchorRef} className="flex shrink-0 items-center">
      <IdentityLinkChip
        openHref={openHref}
        openTitle="Open claim in Zendesk"
        value={value}
        display={display}
        tone="ticket"
        underlineClass="border-orange-500"
        disableCopy={!value.trim()}
        onEdit={() => setOpen(true)}
        editOpen={open}
        editLabel="View ticket history"
        actionsInMenu
      />
      <AnchoredLayer
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        placement="bottom-end"
        level="panelPopover"
        gap={6}
      >
        <TicketThreadPanel
          ticketId={zendeskTicketId}
          displayTicketId={display}
          open={open}
          receivingId={receivingId}
          lineId={lineId}
          onUnlinked={() => {
            setOpen(false);
            onUnlinked();
          }}
        />
      </AnchoredLayer>
    </div>
  );
}

function TicketThreadPanel({
  ticketId,
  displayTicketId,
  open,
  receivingId,
  lineId,
  onUnlinked,
}: {
  ticketId: number | null;
  displayTicketId: string;
  open: boolean;
  receivingId: number | null;
  lineId: number | null;
  onUnlinked: () => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useTicketThread(ticketId, open);

  const unlink = useMutation<{ removed: boolean }, Error>({
    mutationFn: async () => {
      if (receivingId == null || ticketId == null) {
        throw new Error('Missing receiving link');
      }
      const sp = new URLSearchParams({
        receivingId: String(receivingId),
        ticketId: String(ticketId),
      });
      if (lineId != null) sp.set('lineId', String(lineId));
      const res = await fetch(`/api/receiving/zendesk-claim/link?${sp.toString()}`, {
        method: 'DELETE',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `Request failed (${res.status})`);
      }
      return { removed: !!json.removed };
    },
    onSuccess: () => {
      if (ticketId != null) qc.removeQueries({ queryKey: threadKey(ticketId) });
      toast.success('Ticket unlinked');
      onUnlinked();
    },
    onError: (err) => toast.error(err.message || 'Could not unlink the ticket'),
  });

  // Archive this carton's photos to the NAS folder named after the ticket (via
  // the office agent) — the same publish the claim modal does, available here so
  // it can be (re)triggered from the filed-ticket dropdown.
  const archive = useMutation<{ folderName: string; copied: number; total: number }, Error>({
    mutationFn: async () => {
      if (receivingId == null || ticketId == null) {
        throw new Error('Missing receiving link');
      }
      const res = await fetch('/api/receiving/zendesk-claim/archive-only', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receivingId, lineId, ticketNumber: String(ticketId) }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `Request failed (${res.status})`);
      }
      return { folderName: json.folderName, copied: json.copied, total: json.total };
    },
    onSuccess: (d) => toast.success(`Archived ${d.copied}/${d.total} photo(s) → ${d.folderName}`),
    onError: (err) => toast.error(err.message || 'Could not archive photos'),
  });

  return (
    <div
      role="dialog"
      aria-label="Ticket history"
      className="flex max-h-[460px] w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-border-soft bg-surface-card shadow-xl"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-border-hairline px-3 py-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
          <div className="min-w-0">
            <div className="break-words text-[13px] font-semibold leading-snug text-text-default">
              {displayTicketId ? `Ticket ${displayTicketId.startsWith('#') ? displayTicketId : `#${displayTicketId}`}` : 'Ticket'}
            </div>
            {data?.ticket.subject ? (
              <div className="break-words text-micro leading-snug text-text-faint">{data.ticket.subject}</div>
            ) : null}
          </div>
        </div>
        <div className="flex max-w-full flex-wrap items-center justify-end gap-1.5">
          {data?.ticket.status ? (
            <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-micro font-medium uppercase tracking-wide text-text-soft">
              {data.ticket.status}
            </span>
          ) : null}
          {data?.ticket.url ? (
            <HoverTooltip label="Open in Zendesk" asChild>
              <a
                href={data.ticket.url}
                target="_blank"
                rel="noreferrer"
                aria-label="Open in Zendesk"
                className="rounded-md p-1 text-text-faint transition hover:bg-surface-sunken hover:text-text-muted"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </HoverTooltip>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {!ticketId ? (
          <p className="py-6 text-center text-sm text-text-faint">No ticket id to look up.</p>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
          </div>
        ) : isError ? (
          <p className="rounded-md bg-rose-50 px-2 py-1.5 text-caption text-rose-600">
            History unavailable: {error instanceof Error ? error.message : 'request failed'}
          </p>
        ) : !data || data.comments.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-faint">No history yet.</p>
        ) : (
          <ul className="space-y-2">
            {data.comments.map((c) => (
              <li
                key={c.id}
                className={cn(
                  'rounded-lg border px-3 py-2',
                  c.public ? 'border-blue-100 bg-blue-50/60' : 'border-amber-100 bg-amber-50/60',
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-2 text-micro uppercase tracking-wide">
                  <span className={c.public ? 'font-semibold text-blue-600' : 'font-semibold text-amber-600'}>
                    {c.public ? 'Public reply' : 'Internal note'}
                  </span>
                  <span className="flex items-center gap-1 normal-case text-text-faint">
                    <Clock className="h-3 w-3" />
                    {formatDateTimePST(c.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-text-default">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-border-hairline bg-surface-canvas/60 px-3 py-2.5">
        <span className="min-w-0 flex-1 text-caption leading-snug text-text-faint">
          Unlinking only removes our reference — the ticket stays in Zendesk.
        </span>
        <HoverTooltip label="Archive this carton's photos to the ticket's NAS folder" asChild>
          <Button
            variant="secondary"
            size="sm"
            loading={archive.isPending}
            icon={<Archive className="h-3.5 w-3.5" />}
            disabled={archive.isPending || receivingId == null || ticketId == null}
            onClick={() => archive.mutate()}
            aria-label="Archive this carton's photos to the ticket's NAS folder"
            className="shrink-0 border border-blue-200 bg-surface-card text-blue-700 ring-0 hover:bg-blue-50"
          >
            Archive
          </Button>
        </HoverTooltip>
        <Button
          variant="secondary"
          size="sm"
          loading={unlink.isPending}
          icon={<Unlink className="h-3.5 w-3.5" />}
          disabled={unlink.isPending || receivingId == null}
          onClick={() => unlink.mutate()}
          className="shrink-0 border border-rose-200 bg-surface-card text-rose-600 ring-0 hover:bg-rose-50"
        >
          Unlink
        </Button>
      </footer>
    </div>
  );
}

export default ReceivingTicketChip;
