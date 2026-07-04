'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Link2, Loader2, MessageSquare, Search, Send, Unlink, X } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { cn } from '@/utils/_cn';
import { toast } from '@/lib/toast';
import { Button, IconButton } from '@/design-system/primitives';
import { AnchoredLayer } from '@/design-system/primitives/AnchoredLayer';
import { useWarrantyClaim } from '@/hooks/useWarrantyClaims';
import { useWarrantyMutations } from '@/hooks/useWarrantyMutations';
import {
  useWarrantyTicket,
  useWarrantyTicketCandidates,
  useWarrantyTicketComments,
  useWarrantyZendeskMutations,
  WarrantyZendeskDraftError,
} from '@/hooks/useWarrantyZendesk';
import {
  mergeWarrantyTimeline,
  warrantyEventLabel,
  type WarrantyTimelineEntry,
} from '@/lib/warranty/zendesk-format';
import { formatDateTimePST } from '@/utils/date';

/**
 * Single icon-button entry point for a claim's support thread. Click → anchored
 * popover with the merged history (internal claim events + Zendesk comments,
 * chronological), a reply composer, create-ticket when none is linked yet, and
 * a resolve action. Comments are fetched live from Zendesk when the popover
 * opens (read-time sync; Zendesk owns the conversation).
 */
export function WarrantyTicketButton({
  claimId,
  linked,
  className,
}: {
  claimId: number;
  /** Whether the claim already has a linked Zendesk ticket (drives the tint). */
  linked: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <HoverTooltip label={linked ? 'Support ticket thread' : 'Create Zendesk ticket'} asChild>
        <IconButton
          ref={buttonRef}
          type="button"
          ariaLabel={linked ? 'Open support ticket thread' : 'Create Zendesk ticket'}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          icon={<MessageSquare className="h-4 w-4" />}
          className={cn(
            'rounded-md p-1.5 transition',
            linked
              ? 'text-blue-600 hover:bg-blue-50'
              : 'text-text-faint hover:bg-surface-sunken hover:text-text-soft',
            className,
          )}
        />
      </HoverTooltip>
      <AnchoredLayer
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        placement="bottom-end"
        level="panelPopover"
        gap={6}
      >
        <WarrantyTicketPanel claimId={claimId} />
      </AnchoredLayer>
    </>
  );
}

function TimelineRow({ entry }: { entry: WarrantyTimelineEntry }) {
  if (entry.kind === 'event') {
    return (
      <li className="flex items-start gap-2 px-1 text-caption text-text-faint">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-surface-strong" />
        <span>
          <span className="font-medium text-text-soft">{warrantyEventLabel(entry.event)}</span>
          <span className="ml-2">{formatDateTimePST(entry.createdAt)}</span>
        </span>
      </li>
    );
  }
  const { comment } = entry;
  return (
    <li
      className={cn(
        'rounded-lg border px-3 py-2',
        comment.public ? 'border-blue-100 bg-blue-50/60' : 'border-amber-100 bg-amber-50/60',
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-micro uppercase tracking-wide">
        <span className={comment.public ? 'font-semibold text-blue-600' : 'font-semibold text-amber-600'}>
          {comment.public ? 'Public reply' : 'Internal note'}
        </span>
        <span className="text-text-faint normal-case">{formatDateTimePST(comment.createdAt)}</span>
      </div>
      <p className="whitespace-pre-wrap text-[13px] leading-snug text-text-default">{comment.body}</p>
    </li>
  );
}

function WarrantyTicketPanel({ claimId }: { claimId: number }) {
  const { data: claim, isLoading: claimLoading } = useWarrantyClaim(claimId);
  const linked = claim?.zendeskTicketId != null;

  const ticketQuery = useWarrantyTicket(claimId, linked);
  const commentsQuery = useWarrantyTicketComments(claimId, linked);
  const { createTicket, reply, linkExisting, unlink } = useWarrantyZendeskMutations(claimId);
  const { lifecycle } = useWarrantyMutations();

  const [draft, setDraft] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Link-an-existing-ticket picker (only relevant while unlinked). `linkQuery`
  // doubles as the search box and the manual "#1234" id entry — the server
  // resolves a bare id to a direct lookup, so typing one behaves exactly like
  // picking it from the recent list. Debounced so each keystroke isn't a fetch.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkQuery, setLinkQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(linkQuery), 250);
    return () => clearTimeout(t);
  }, [linkQuery]);
  const candidatesQuery = useWarrantyTicketCandidates(claimId, debouncedQuery, linkOpen && !linked);

  const timeline = useMemo(
    () => mergeWarrantyTimeline(claim?.events ?? [], commentsQuery.data ?? []),
    [claim?.events, commentsQuery.data],
  );

  // Keep the newest entry in view as the thread loads/grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [timeline.length]);

  const canResolve =
    linked && claim != null && ['APPROVED', 'DENIED', 'REPAIRED', 'EXPIRED'].includes(claim.status);

  const createDraft =
    createTicket.error instanceof WarrantyZendeskDraftError ? createTicket.error : null;

  const sendReply = () => {
    const body = draft.trim();
    if (!body || reply.isPending) return;
    reply.mutate({ body, isPublic }, { onSuccess: () => setDraft('') });
  };

  return (
    <div
      role="dialog"
      aria-label="Support ticket thread"
      className="flex max-h-[480px] w-[380px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-border-soft bg-surface-card shadow-xl"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border-hairline px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquare className="h-4 w-4 shrink-0 text-blue-600" />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-text-default">
              {linked ? `Ticket #${claim?.zendeskTicketId}` : 'Support thread'}
            </div>
            <div className="truncate font-mono text-micro text-text-faint">{claim?.claimNumber}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {ticketQuery.data?.ticket && (
            <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-micro font-medium uppercase tracking-wide text-text-soft">
              {ticketQuery.data.ticket.status}
            </span>
          )}
          {ticketQuery.data?.ticketUrl && (
            <HoverTooltip label="Open in Zendesk" asChild>
              <a
                href={ticketQuery.data.ticketUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Open in Zendesk"
                className="rounded-md p-1 text-text-faint transition hover:bg-surface-sunken hover:text-text-muted"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </HoverTooltip>
          )}
          {linked && (
            <HoverTooltip label="Unlink ticket (it stays in Zendesk)" asChild>
            <IconButton
              type="button"
              disabled={unlink.isPending}
              ariaLabel="Unlink ticket"
              onClick={() => {
                const ticketId = claim?.zendeskTicketId;
                if (ticketId == null) return;
                if (
                  !window.confirm(
                    `Unlink ticket #${ticketId} from this claim? The ticket stays in Zendesk — only the claim link is removed.`,
                  )
                ) {
                  return;
                }
                unlink.mutate(ticketId, {
                  onSuccess: () => toast.success(`Unlinked ticket #${ticketId}`),
                  onError: (e) =>
                    toast.error(e instanceof Error ? e.message : 'Unlink failed'),
                });
              }}
              icon={
                unlink.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Unlink className="h-3.5 w-3.5" />
                )
              }
              className="rounded-md p-1 text-text-faint transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
            />
            </HoverTooltip>
          )}
          {canResolve && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={lifecycle.isPending}
              onClick={() => lifecycle.mutate({ id: claimId, action: 'close' })}
              className="h-auto rounded-md bg-emerald-600 px-2 py-1 text-caption font-medium text-white hover:bg-emerald-700"
            >
              {lifecycle.isPending ? 'Resolving…' : 'Resolve'}
            </Button>
          )}
        </div>
      </header>

      {claimLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        </div>
      ) : !claim ? (
        <p className="px-3 py-6 text-center text-sm text-text-faint">Claim not found.</p>
      ) : (
        <>
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {commentsQuery.isFetching && timeline.length === 0 ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              </div>
            ) : timeline.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-faint">No history yet.</p>
            ) : (
              <ul className="space-y-2">
                {timeline.map((entry) => (
                  <TimelineRow key={entry.key} entry={entry} />
                ))}
              </ul>
            )}
            {commentsQuery.isError && (
              <p className="rounded-md bg-rose-50 px-2 py-1.5 text-caption text-rose-600">
                Zendesk history unavailable:{' '}
                {commentsQuery.error instanceof Error ? commentsQuery.error.message : 'request failed'}
              </p>
            )}
          </div>

          <footer className="border-t border-border-hairline bg-surface-canvas/60 px-3 py-2.5">
            {!linked ? (
              <div className="space-y-2">
                <p className="text-label text-text-soft">
                  No Zendesk ticket yet — create one from this claim to start the support thread.
                </p>
                {createDraft && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-2">
                    <p className="mb-1 text-caption font-medium text-amber-700">
                      {createDraft.message} — copy the draft and file it manually:
                    </p>
                    <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap text-caption text-text-muted">
                      {[createDraft.draftSubject, createDraft.draftBody].filter(Boolean).join('\n\n')}
                    </pre>
                  </div>
                )}
                {createTicket.isError && !createDraft && (
                  <p className="text-caption text-rose-600">
                    {createTicket.error instanceof Error ? createTicket.error.message : 'Create failed.'}
                  </p>
                )}
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  disabled={createTicket.isPending}
                  loading={createTicket.isPending}
                  onClick={() => createTicket.mutate()}
                  icon={<Send className="h-4 w-4" />}
                  className="w-full text-sm font-medium"
                >
                  Create Zendesk ticket
                </Button>

                {/* Link an EXISTING ticket — for claims whose ticket was filed
                    by email (the common case). Search, or type a ticket # by
                    hand; the manual id resolves identically to a list pick. */}
                {!linkOpen ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setLinkOpen(true)}
                    icon={<Link2 className="h-3.5 w-3.5" />}
                    className="h-auto w-full justify-center gap-1.5 rounded-lg border border-border-soft px-3 py-1.5 text-label font-medium text-text-muted hover:bg-surface-hover"
                  >
                    Link an existing ticket
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-lg border border-border-soft p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-caption font-semibold text-text-muted">Link existing ticket</span>
                      <IconButton
                        type="button"
                        onClick={() => {
                          setLinkOpen(false);
                          setLinkQuery('');
                        }}
                        ariaLabel="Cancel linking"
                        icon={<X className="h-3.5 w-3.5" />}
                        className="rounded p-0.5 text-text-faint transition hover:bg-surface-sunken hover:text-text-muted"
                      />
                    </div>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
                      <input
                        value={linkQuery}
                        onChange={(e) => setLinkQuery(e.target.value)}
                        placeholder="Search subject or type ticket # (e.g. 12345)"
                        autoFocus
                        className="w-full rounded-md border border-border-soft py-1.5 pl-7 pr-2 text-label focus:border-blue-300 focus:outline-none"
                      />
                    </div>
                    {linkExisting.isError && (
                      <p className="text-caption text-rose-600">
                        {linkExisting.error instanceof Error ? linkExisting.error.message : 'Link failed.'}
                      </p>
                    )}
                    <div className="max-h-44 space-y-1 overflow-y-auto">
                      {candidatesQuery.isFetching ? (
                        <div className="flex items-center justify-center py-3">
                          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                        </div>
                      ) : candidatesQuery.isError ? (
                        <p className="px-1 py-2 text-caption text-rose-600">
                          {candidatesQuery.error instanceof Error ? candidatesQuery.error.message : 'Search failed.'}
                        </p>
                      ) : (candidatesQuery.data?.tickets.length ?? 0) === 0 ? (
                        <p className="px-1 py-2 text-center text-caption text-text-faint">
                          {debouncedQuery.trim() ? 'No matching tickets.' : 'No recent tickets.'}
                        </p>
                      ) : (
                        candidatesQuery.data!.tickets.map((t) => (
                          <Button
                            key={t.id}
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={linkExisting.isPending}
                            onClick={() =>
                              linkExisting.mutate(t.id, {
                                onSuccess: () => {
                                  setLinkOpen(false);
                                  setLinkQuery('');
                                  toast.success(`Linked ticket #${t.id}`);
                                },
                              })
                            }
                            className="h-auto w-full items-start justify-start gap-2 rounded-md border border-border-hairline px-2 py-1.5 text-left hover:border-blue-200 hover:bg-blue-50/40"
                          >
                            <span className="mt-0.5 shrink-0 font-mono text-micro font-semibold text-text-faint">
                              #{t.id}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-label font-medium text-text-muted">
                                {t.subject || '(no subject)'}
                              </span>
                              <span className="block text-micro uppercase tracking-wide text-text-faint">
                                {t.status}
                              </span>
                            </span>
                            <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                          </Button>
                        ))
                      )}
                    </div>
                    {(candidatesQuery.data?.hiddenLinked ?? 0) > 0 && (
                      <p className="px-1 text-micro text-text-faint">
                        {candidatesQuery.data!.hiddenLinked} hidden — already linked elsewhere.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {reply.isError && (
                  <p className="text-caption text-rose-600">
                    {reply.error instanceof Error ? reply.error.message : 'Reply failed.'}
                  </p>
                )}
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      sendReply();
                    }
                  }}
                  placeholder={isPublic ? 'Reply to the customer…' : 'Add an internal note…'}
                  rows={2}
                  autoFocus
                  className="w-full resize-none rounded-md border border-border-soft px-2 py-1.5 text-sm focus:border-blue-300 focus:outline-none"
                />
                <div className="flex items-center justify-between gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5 text-caption text-text-soft">
                    <input
                      type="checkbox"
                      checked={isPublic}
                      onChange={(e) => setIsPublic(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-border-default"
                    />
                    Customer-visible reply
                  </label>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={reply.isPending || draft.trim().length === 0}
                    loading={reply.isPending}
                    onClick={sendReply}
                    icon={<Send className="h-3.5 w-3.5" />}
                    className="text-label font-medium"
                  >
                    Send
                  </Button>
                </div>
              </div>
            )}
          </footer>
        </>
      )}
    </div>
  );
}
