'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, MessageSquare } from '@/components/Icons';
import { toast } from '@/lib/toast';
import { AnchoredLayer } from '@/design-system/primitives/AnchoredLayer';
import type { ClaimType } from '@/lib/zendesk-claim-template';

const sellerMessageKey = (receivingId: number, lineId: number | null) =>
  ['receiving', 'claim-seller-message', receivingId, lineId ?? 0] as const;

import { copySellerClaimMessageWithPersist } from '@/lib/receiving-claim-seller-copy';
import { sellerDraftMatchesTicket } from '@/lib/receiving-claim-seller-ticket-match';

interface SellerMessagePayload {
  id: number;
  sellerMessage: string;
  subjectSnapshot: string | null;
  model: string | null;
  zendeskTicketId: number | null;
  updatedAt: string;
}

interface ZendeskTicketPayload {
  id?: number;
  subject?: string | null;
  description?: string | null;
  raw_subject?: string | null;
  tags?: string[];
}

function inferClaimType(text: string): ClaimType {
  const haystack = text.toLowerCase();
  if (haystack.includes('missing item') || /\bmissing\b/.test(haystack)) return 'missing';
  if (haystack.includes('wrong item') || haystack.includes('incorrect item')) return 'wrong_item';
  if (haystack.includes('vendor defect') || haystack.includes('defective')) return 'vendor_defect';
  if (haystack.includes('unfound') || haystack.includes('no po match')) return 'unfound';
  if (haystack.includes('repair service')) return 'repair_service';
  return 'damage';
}

function fallbackTicketSubject(ticketId: number | null): string {
  return ticketId ? `Receiving Claim — Ticket #${ticketId}` : 'Receiving Claim';
}

function fallbackTicketBody(ticketId: number | null): string {
  return [
    'Issue: Damage',
    'Purchase Order: n/a',
    'Tracking: n/a',
    'Scope: package-wide (no specific item)',
    '',
    ticketId ? `Zendesk ticket: #${ticketId}` : null,
  ].filter(Boolean).join('\n');
}

function useSellerMessage(
  receivingId: number | null,
  lineId: number | null,
  linkedTicketId: number | null,
  open: boolean,
) {
  return useQuery<SellerMessagePayload | null, Error>({
    queryKey: sellerMessageKey(receivingId ?? 0, lineId),
    queryFn: async () => {
      const sp = new URLSearchParams({ receivingId: String(receivingId) });
      if (lineId != null) sp.set('lineId', String(lineId));
      const res = await fetch(`/api/receiving/zendesk-claim/seller-message?${sp}`, { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      const message = (data.message as SellerMessagePayload | null) ?? null;
      if (
        message &&
        linkedTicketId != null &&
        !sellerDraftMatchesTicket(message.zendeskTicketId, linkedTicketId, `#${linkedTicketId}`)
      ) {
        return null;
      }
      return message;
    },
    enabled: open && receivingId != null,
    staleTime: 15_000,
    retry: false,
  });
}

/**
 * Chat icon beside a filed claim # — opens the saved seller-facing message
 * (marketplace / eBay copy) stored in Neon after AI refine or claim submit.
 */
export function SellerMessageChip({
  receivingId,
  lineId,
  linkedTicketId,
}: {
  receivingId: number | null;
  lineId: number | null;
  /** Numeric Zendesk id currently linked — stale drafts for other tickets are hidden. */
  linkedTicketId?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  if (receivingId == null) return null;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Seller message draft"
        title="Seller message draft"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-full border border-blue-200 bg-blue-50 text-blue-600 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-100"
      >
        <MessageSquare className="h-3.5 w-3.5" />
      </button>
      <AnchoredLayer
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchorRef}
        placement="bottom-end"
        level="panelPopover"
        gap={6}
      >
        <SellerMessagePanel
          receivingId={receivingId}
          lineId={lineId}
          linkedTicketId={linkedTicketId ?? null}
          open={open}
          onClose={() => setOpen(false)}
        />
      </AnchoredLayer>
    </>
  );
}

function SellerMessagePanel({
  receivingId,
  lineId,
  linkedTicketId,
  open,
  onClose,
}: {
  receivingId: number;
  lineId: number | null;
  linkedTicketId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useSellerMessage(receivingId, lineId, linkedTicketId, open);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!open) {
      setDraft('');
      return;
    }
    if (data?.sellerMessage) setDraft(data.sellerMessage);
  }, [open, data?.sellerMessage]);

  const save = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch('/api/receiving/zendesk-claim/seller-message', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivingId,
          lineId,
          sellerMessage: text,
          subjectSnapshot: data?.subjectSnapshot ?? undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `Request failed (${res.status})`);
      }
      return json.message as SellerMessagePayload;
    },
    onSuccess: (msg) => {
      qc.setQueryData(sellerMessageKey(receivingId, lineId), msg);
      setDraft(msg.sellerMessage);
      toast.success('Seller message saved');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not save'),
  });

  const generate = useMutation({
    mutationFn: async () => {
      let subject = data?.subjectSnapshot?.trim() || fallbackTicketSubject(linkedTicketId);
      let description = fallbackTicketBody(linkedTicketId);
      let claimType: ClaimType = inferClaimType(subject);

      if (linkedTicketId != null) {
        const ticketRes = await fetch(`/api/zendesk/tickets/${linkedTicketId}`, { cache: 'no-store' });
        if (ticketRes.ok) {
          const ticketJson = await ticketRes.json().catch(() => null);
          const ticket = ticketJson?.ticket as ZendeskTicketPayload | undefined;
          const ticketSubject = String(ticket?.subject || ticket?.raw_subject || '').trim();
          const ticketDescription = String(ticket?.description || '').trim();
          if (ticketSubject) subject = ticketSubject;
          if (ticketDescription) description = ticketDescription;
          claimType = inferClaimType(
            [
              ticketSubject,
              ticketDescription,
              Array.isArray(ticket?.tags) ? ticket.tags.join(' ') : '',
            ].join('\n'),
          );
        }
      }

      const res = await fetch('/api/receiving/zendesk-claim/assist-seller', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receivingId,
          lineId,
          claimType,
          subject,
          description,
          zendeskTicketNumber: linkedTicketId != null ? `#${linkedTicketId}` : '#pending',
          zendeskTicketId: linkedTicketId,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `Request failed (${res.status})`);
      }
      return {
        id: Number(json.sellerMessageId ?? 0) || Date.now(),
        sellerMessage: String(json.sellerMessage || ''),
        subjectSnapshot: subject,
        model: typeof json.model === 'string' ? json.model : null,
        zendeskTicketId: linkedTicketId,
        updatedAt: new Date().toISOString(),
        linksStripped: Boolean(json.linksStripped),
        degraded: Boolean(json.degraded),
      } as SellerMessagePayload & { linksStripped?: boolean; degraded?: boolean };
    },
    onSuccess: (msg) => {
      qc.setQueryData(sellerMessageKey(receivingId, lineId), msg);
      setDraft(msg.sellerMessage);
      if (msg.linksStripped) {
        toast.warning('Links were removed from the seller message');
      } else if (msg.degraded) {
        toast.success('Seller message generated from template');
      } else {
        toast.success('Seller message generated');
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not generate message'),
  });

  const dirty = data ? draft.trim() !== data.sellerMessage.trim() : draft.trim().length > 0;

  const handleCopy = async () => {
    const text = draft.trim();
    if (!text) return;
    const { ok, messageId } = await copySellerClaimMessageWithPersist({
      text,
      messageId: data?.id ?? null,
      receivingId,
      lineId,
      subjectSnapshot: data?.subjectSnapshot ?? undefined,
    });
    if (messageId != null && data) {
      qc.setQueryData(sellerMessageKey(receivingId, lineId), { ...data, id: messageId });
    }
    if (ok) {
      toast.success(
        messageId != null
          ? `Copied · Seller msg #${messageId} (header clipboard)`
          : 'Copied to clipboard',
      );
    } else {
      toast.error('Could not copy');
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Seller message"
      className="flex max-h-[420px] w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
    >
      <header className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquare className="h-4 w-4 shrink-0 text-blue-600" />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-gray-800">Seller message</div>
            <div className="truncate text-[10px] text-gray-400">Plain text — no links (marketplace TOS)</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-[11px] font-semibold text-gray-500 hover:bg-gray-100"
        >
          Close
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
          </div>
        ) : isError ? (
          <p className="rounded-md bg-rose-50 px-2 py-1.5 text-[11px] text-rose-600">
            {error instanceof Error ? error.message : 'Could not load message'}
          </p>
        ) : !data && !draft.trim() ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="max-w-[260px] text-sm text-gray-400">
              No seller message yet for this ticket.
            </p>
            <button
              type="button"
              disabled={generate.isPending}
              onClick={() => generate.mutate()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-[11px] font-black uppercase tracking-widest text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {generate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
              AI generate
            </button>
          </div>
        ) : (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={10}
            className="block w-full resize-y rounded-lg border border-blue-100 bg-white px-3 py-2 text-[13px] leading-snug text-gray-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
            placeholder="Seller-facing message…"
          />
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-gray-100 bg-gray-50/60 px-3 py-2.5">
        <button
          type="button"
          disabled={!draft.trim()}
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          <Copy className="h-3.5 w-3.5" />
          Copy
        </button>
        <button
          type="button"
          disabled={save.isPending || generate.isPending || !dirty || !draft.trim()}
          onClick={() => save.mutate(draft.trim())}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Save
        </button>
      </footer>
    </div>
  );
}

export default SellerMessageChip;
