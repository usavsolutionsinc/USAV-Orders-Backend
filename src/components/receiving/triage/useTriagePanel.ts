'use client';

/**
 * useTriagePanel — data + actions for the triage Smart-Matching section
 * (`LineMatchingSection`, rendered inside the shared `LineEditPanel`).
 *
 * Every signal/action is wired to a REAL endpoint already in the app — there is
 * no fabricated match service and no confidence score:
 *   • Match candidates → GET  /api/receiving/zendesk-claim/link  (ticket list)
 *   • Match to order   → POST /api/receiving/zendesk-claim/link  (link a ticket)
 *   • eBay corroboration → GET /api/receiving-lines/incoming/details (delivered emails)
 *   • Manual review    → PATCH /api/receiving/unfound-queue/unmatched_receiving/:id
 *
 * Notes, photos, routing-to-unbox and the create-claim modal are intentionally
 * NOT here — those are owned by the reused LineEditPanel sections / controller,
 * so this hook stays focused on matching.
 *
 * Matching is grain-ed to the CARTON (receivingId, no lineId): a returned
 * package maps to one customer claim, so the ticket links to the package.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { dispatchLineUpdated } from '@/components/station/receiving-lines-table-helpers';
import { invalidateReceivingFeeds } from '@/lib/queries/receiving-queries';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import {
  toTriagePackage,
  type TicketCandidate,
  type DeliveredEmailSignal,
} from './triage-types';

interface DeliveredEmailApiRow {
  order_number?: string | null;
  delivered_at?: string | null;
  email_subject?: string | null;
  email_from?: string | null;
}

export function useTriagePanel({
  row,
  loadCandidates = true,
  loadDeliveredEmails = true,
}: {
  row: ReceivingLineRow;
  /** When false, Zendesk ticket candidates are not fetched until the tab opens. */
  loadCandidates?: boolean;
  /** When false, delivered-email corroboration is not fetched until needed. */
  loadDeliveredEmails?: boolean;
}) {
  const queryClient = useQueryClient();
  const pkg = useMemo(() => toTriagePackage(row), [row]);

  // ── Smart Matching: Zendesk ticket candidates (debounced search) ───────────
  const [matchQuery, setMatchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(matchQuery.trim()), 250);
    return () => clearTimeout(id);
  }, [matchQuery]);
  // Reset search when a different package opens.
  useEffect(() => {
    setMatchQuery('');
    setDebouncedQuery('');
  }, [pkg.lineId]);

  const candidatesEnabled = loadCandidates && !!pkg.receivingId && pkg.receivingId > 0;
  const candidatesQuery = useQuery<{
    success: boolean;
    tickets: TicketCandidate[];
    hiddenLinked: number;
  }>({
    queryKey: ['triage-ticket-candidates', pkg.receivingId, debouncedQuery],
    queryFn: async () => {
      const params = new URLSearchParams({ receivingId: String(pkg.receivingId) });
      if (debouncedQuery) params.set('query', debouncedQuery);
      const res = await fetch(`/api/receiving/zendesk-claim/link?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: candidatesEnabled,
    staleTime: 15_000,
  });

  const [linkingId, setLinkingId] = useState<number | null>(null);
  const linkTicket = useCallback(
    async (ticketId: number) => {
      if (!pkg.receivingId) return;
      setLinkingId(ticketId);
      try {
        const res = await fetch('/api/receiving/zendesk-claim/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ receivingId: pkg.receivingId, ticketId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
          toast.error(data?.error || 'Could not match ticket');
          return;
        }
        const ticketNumber = data.ticketNumber ?? `#${ticketId}`;
        toast.success(`Matched to Zendesk ${ticketNumber}`);
        dispatchLineUpdated({ id: pkg.lineId, zendesk_ticket: ticketNumber });
        await queryClient.invalidateQueries({
          queryKey: ['triage-ticket-candidates', pkg.receivingId],
        });
        invalidateReceivingFeeds(queryClient);
      } catch {
        toast.error('Could not match ticket');
      } finally {
        setLinkingId(null);
      }
    },
    [pkg.receivingId, pkg.lineId, queryClient],
  );

  // ── eBay "order delivered" email corroboration (real signal, degrade-empty) ─
  const deliveredQuery = useQuery<DeliveredEmailSignal[]>({
    queryKey: ['triage-delivered-emails', pkg.zohoPoId],
    queryFn: async () => {
      const res = await fetch(
        `/api/receiving-lines/incoming/details?po_id=${encodeURIComponent(pkg.zohoPoId!)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) return [];
      const data = await res.json().catch(() => null);
      const rows: DeliveredEmailApiRow[] = Array.isArray(data?.delivered_emails)
        ? data.delivered_emails
        : [];
      return rows
        .filter((e) => !!e.order_number)
        .map((e) => ({
          orderNumber: String(e.order_number),
          deliveredAt: e.delivered_at ?? null,
          subject: e.email_subject ?? null,
          from: e.email_from ?? null,
        }));
    },
    enabled: loadDeliveredEmails && !!pkg.zohoPoId,
    staleTime: 60_000,
  });

  // ── Manual review (unfound-overlay note; unmatched cartons only) ────────────
  const [markingReview, setMarkingReview] = useState(false);
  const canMarkReview = pkg.isUnmatched && !!pkg.receivingId;
  const markManualReview = useCallback(
    async (note?: string) => {
      if (!canMarkReview) return;
      setMarkingReview(true);
      try {
        const usaNote = (note ?? '').trim() || 'Flagged for manual review from triage';
        const res = await fetch(
          `/api/receiving/unfound-queue/unmatched_receiving/${pkg.receivingId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usa_team_note: usaNote }),
          },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
          toast.error(data?.error || 'Could not flag for review');
          return;
        }
        toast.success('Flagged for manual review');
        invalidateReceivingFeeds(queryClient);
      } catch {
        toast.error('Could not flag for review');
      } finally {
        setMarkingReview(false);
      }
    },
    [canMarkReview, pkg.receivingId, queryClient],
  );

  return {
    pkg,
    matchQuery,
    setMatchQuery,
    candidates: candidatesQuery.data?.tickets ?? [],
    hiddenLinked: candidatesQuery.data?.hiddenLinked ?? 0,
    candidatesLoading: candidatesQuery.isLoading,
    candidatesFetching: candidatesQuery.isFetching,
    candidatesError: candidatesQuery.isError,
    candidatesEnabled,
    linkTicket,
    linkingId,
    deliveredEmails: deliveredQuery.data ?? [],
    canMarkReview,
    markManualReview,
    markingReview,
  };
}

export type TriagePanelController = ReturnType<typeof useTriagePanel>;
