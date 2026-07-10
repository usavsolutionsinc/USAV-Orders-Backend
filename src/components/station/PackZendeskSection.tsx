'use client';

/**
 * PackZendeskSection — compact Zendesk reach-in for the packing bench
 * (Tier-3 A3). Lives on the active-order card, collapsed by default so it
 * never competes with the scan loop (station archetype: no autofocus, no
 * fetch until the packer deliberately opens it).
 *
 * Expanded: a small ticket search (seeded with the active order id) over the
 * existing /api/zendesk/tickets route via useZendeskTickets, a pick-one list,
 * and a comment box that POSTs through useAddComment (internal note by
 * default). Reuses the /support data layer — no new API surface.
 */

import { useEffect, useState } from 'react';
import { ChevronDown, Loader2, MessageSquare, Search, Send } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import {
  useZendeskTickets,
  useAddComment,
  isNotConfigured,
} from '@/hooks/useZendeskQueries';
import type { ZendeskTicket } from '@/lib/zendesk';

interface PackZendeskSectionProps {
  /** Active order id — seeds the ticket search. */
  orderId?: string | null;
  className?: string;
}

export function PackZendeskSection({ orderId, className }: PackZendeskSectionProps) {
  const [open, setOpen] = useState(false);

  // New active order → collapse again so the bench stays scan-first.
  useEffect(() => {
    setOpen(false);
  }, [orderId]);

  return (
    <div className={`rounded-2xl border border-border-soft bg-surface-card overflow-hidden ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="ds-raw-button flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover"
      >
        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-text-soft" />
        <span className="flex-1 text-eyebrow font-black uppercase tracking-widest text-text-soft">
          Zendesk ticket
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-text-faint transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? <PackZendeskBody orderId={orderId} /> : null}
    </div>
  );
}

function PackZendeskBody({ orderId }: { orderId?: string | null }) {
  const seeded = (orderId ?? '').trim();
  const [text, setText] = useState(seeded);
  const [query, setQuery] = useState(seeded);
  const [selected, setSelected] = useState<ZendeskTicket | null>(null);
  const [comment, setComment] = useState('');
  const [isPublic, setIsPublic] = useState(false);

  // Light debounce so the search doesn't fire per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(text), 350);
    return () => clearTimeout(t);
  }, [text]);

  const tickets = useZendeskTickets({ query, status: 'open', page: 1, perPage: 5 });
  const addComment = useAddComment();

  const rows = tickets.data?.tickets ?? [];
  const notConfigured = tickets.error != null && isNotConfigured(tickets.error);

  const send = () => {
    const body = comment.trim();
    if (!selected || !body || addComment.isPending) return;
    addComment.mutate(
      { id: selected.id, body, isPublic },
      { onSuccess: () => setComment('') },
    );
  };

  return (
    <div className="space-y-2 border-t border-border-hairline px-3 py-2.5">
      <div className="flex items-center gap-1.5 rounded-lg border border-border-soft bg-surface-canvas px-2 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-text-faint" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search tickets — order #, buyer email…"
          className="w-full bg-transparent text-caption font-semibold text-text-default outline-none placeholder:text-text-faint"
        />
        {tickets.isFetching ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-faint" /> : null}
      </div>

      {notConfigured ? (
        <p className="rounded-xl border border-dashed border-border-soft bg-surface-canvas px-3 py-2 text-center text-caption font-semibold text-text-faint">
          Zendesk isn&apos;t configured for this workspace.
        </p>
      ) : tickets.error ? (
        <p className="rounded-xl border border-dashed border-rose-200 bg-rose-50 px-3 py-2 text-center text-caption font-semibold text-rose-700">
          Could not load tickets.
        </p>
      ) : rows.length === 0 && !tickets.isLoading ? (
        <p className="px-1 text-caption font-semibold text-text-faint">No matching tickets.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((t) => {
            const isSelected = selected?.id === t.id;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelected(isSelected ? null : t)}
                  aria-pressed={isSelected}
                  className={`ds-raw-button flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${
                    isSelected
                      ? 'bg-blue-50 ring-1 ring-inset ring-blue-400'
                      : 'hover:bg-surface-hover'
                  }`}
                >
                  <span className="shrink-0 font-mono text-eyebrow font-black tabular-nums text-text-soft">
                    #{t.id}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-caption font-bold text-text-default">
                    {t.subject || 'Untitled ticket'}
                  </span>
                  <span className="shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest text-text-soft">
                    {t.status}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected ? (
        <div className="space-y-1.5 border-t border-border-hairline pt-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder={`Comment on #${selected.id}…`}
            className="w-full resize-none rounded-lg border border-border-soft bg-surface-canvas px-2 py-1.5 text-caption font-semibold text-text-default outline-none placeholder:text-text-faint focus:border-blue-300"
          />
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setIsPublic((p) => !p)}
              aria-pressed={isPublic}
              className={`ds-raw-button rounded-full px-2 py-0.5 text-eyebrow font-black uppercase tracking-widest ring-1 ring-inset ${
                isPublic
                  ? 'bg-blue-50 text-blue-700 ring-blue-200'
                  : 'bg-amber-50 text-amber-700 ring-amber-200'
              }`}
            >
              {isPublic ? 'Public reply' : 'Internal note'}
            </button>
            <Button
              size="sm"
              variant="secondary"
              icon={<Send />}
              loading={addComment.isPending}
              disabled={!comment.trim()}
              onClick={send}
            >
              Send
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
