'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WarrantyZendeskComment } from '@/lib/warranty/zendesk-format';

/**
 * Warranty ↔ Zendesk data layer for the ticket popover. Comments and ticket
 * status are fetched live from Zendesk on open (read-time sync — Zendesk is
 * the conversation's source of truth, we only persist the id mapping).
 */

export interface WarrantyTicketInfo {
  id: number;
  subject: string | null;
  status: string;
  priority: string | null;
  updatedAt: string;
}

/** Thrown by createTicket when Zendesk is unreachable — carries the copyable draft. */
export class WarrantyZendeskDraftError extends Error {
  constructor(
    message: string,
    public readonly draftSubject: string | null,
    public readonly draftBody: string | null,
  ) {
    super(message);
    this.name = 'WarrantyZendeskDraftError';
  }
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) throw new Error(json?.error || `request failed (${res.status})`);
  return json;
}

/** Live status + agent URL of the claim's linked ticket. */
export function useWarrantyTicket(claimId: number | null, linked: boolean) {
  return useQuery({
    queryKey: ['warranty-zendesk-ticket', claimId],
    queryFn: async (): Promise<{ ticket: WarrantyTicketInfo | null; ticketUrl: string | null }> => {
      const json = await getJson(`/api/warranty/claims/${claimId}/zendesk`);
      return { ticket: json.ticket ?? null, ticketUrl: json.ticketUrl ?? null };
    },
    enabled: claimId != null && linked,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}

/** The linked ticket's Zendesk comment thread (replies + internal notes). */
export function useWarrantyTicketComments(claimId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ['warranty-zendesk-comments', claimId],
    queryFn: async (): Promise<WarrantyZendeskComment[]> => {
      const json = await getJson(`/api/warranty/claims/${claimId}/zendesk/comments`);
      return (json.comments ?? []) as WarrantyZendeskComment[];
    },
    enabled: claimId != null && enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}

export function useWarrantyZendeskMutations(claimId: number) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['warranty-claims'] });
    qc.invalidateQueries({ queryKey: ['warranty-claim', claimId] });
    qc.invalidateQueries({ queryKey: ['warranty-zendesk-ticket', claimId] });
    qc.invalidateQueries({ queryKey: ['warranty-zendesk-comments', claimId] });
  };

  /** Create the linked Zendesk ticket (server builds the subject/body template). */
  const createTicket = useMutation({
    mutationFn: async (): Promise<{ ticketId: number; ticketUrl: string | null }> => {
      const res = await fetch(`/api/warranty/claims/${claimId}/zendesk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        // 503/502 carry the template back as a copyable draft.
        if (json?.draftBody || json?.draftSubject) {
          throw new WarrantyZendeskDraftError(
            json?.error || `request failed (${res.status})`,
            json?.draftSubject ?? null,
            json?.draftBody ?? null,
          );
        }
        throw new Error(json?.error || `request failed (${res.status})`);
      }
      return { ticketId: json.ticketId, ticketUrl: json.ticketUrl ?? null };
    },
    onSuccess: invalidate,
  });

  /** Post a reply (public) or internal note to the linked ticket. */
  const reply = useMutation({
    mutationFn: async ({ body, isPublic }: { body: string; isPublic: boolean }) => {
      const res = await fetch(`/api/warranty/claims/${claimId}/zendesk/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, public: isPublic, idempotencyKey: crypto.randomUUID() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || `request failed (${res.status})`);
      return json as { ticketId: number; ticketStatus: string };
    },
    onSuccess: invalidate,
  });

  return { createTicket, reply };
}
