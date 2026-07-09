'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WarrantyZendeskComment } from '@/lib/warranty/zendesk-format';
import { safeRandomUUID } from '@/lib/safe-uuid';

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

/** A linkable Zendesk ticket returned by the candidate search (recent/search/#id). */
export interface WarrantyTicketCandidate {
  id: number;
  subject: string | null;
  description: string | null;
  status: string;
  priority: string | null;
  createdAt: string;
  updatedAt: string;
  url: string | null;
  linkedToThis: boolean;
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

/**
 * Link candidates for an unlinked claim — recent tickets by default, a Zendesk
 * search for a free-text query, or a direct lookup for a typed "#1234". The
 * manual-id path resolves identically to picking from the list (server-side).
 */
export function useWarrantyTicketCandidates(
  claimId: number | null,
  query: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['warranty-zendesk-candidates', claimId, query.trim()],
    queryFn: async (): Promise<{ tickets: WarrantyTicketCandidate[]; hiddenLinked: number }> => {
      const qs = query.trim() ? `?query=${encodeURIComponent(query.trim())}` : '';
      const json = await getJson(`/api/warranty/claims/${claimId}/zendesk/link${qs}`);
      return { tickets: (json.tickets ?? []) as WarrantyTicketCandidate[], hiddenLinked: json.hiddenLinked ?? 0 };
    },
    enabled: claimId != null && enabled,
    staleTime: 10_000,
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
    qc.invalidateQueries({ queryKey: ['warranty-zendesk-candidates', claimId] });
  };

  /** Create the linked Zendesk ticket (server builds the subject/body template). */
  const createTicket = useMutation({
    mutationFn: async (): Promise<{ ticketId: number; ticketUrl: string | null }> => {
      const res = await fetch(`/api/warranty/claims/${claimId}/zendesk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: safeRandomUUID() }),
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
        body: JSON.stringify({ body, public: isPublic, idempotencyKey: safeRandomUUID() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || `request failed (${res.status})`);
      return json as { ticketId: number; ticketStatus: string };
    },
    onSuccess: invalidate,
  });

  /** Link an EXISTING Zendesk ticket to this claim (recent-list pick OR typed #id). */
  const linkExisting = useMutation({
    mutationFn: async (ticketId: number): Promise<{ ticketId: number; ticketUrl: string | null }> => {
      const res = await fetch(`/api/warranty/claims/${claimId}/zendesk/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, idempotencyKey: safeRandomUUID() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || `request failed (${res.status})`);
      return { ticketId: json.ticketId, ticketUrl: json.ticketUrl ?? null };
    },
    onSuccess: invalidate,
  });

  /** Detach the linked ticket — clean reverse (clears column + ticket_links + external_id). */
  const unlink = useMutation({
    mutationFn: async (ticketId: number): Promise<{ detached: boolean }> => {
      const res = await fetch(
        `/api/warranty/claims/${claimId}/zendesk/link?ticketId=${ticketId}`,
        { method: 'DELETE', headers: { Accept: 'application/json' } },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || `request failed (${res.status})`);
      return { detached: Boolean(json.detached) };
    },
    onSuccess: invalidate,
  });

  return { createTicket, reply, linkExisting, unlink };
}
