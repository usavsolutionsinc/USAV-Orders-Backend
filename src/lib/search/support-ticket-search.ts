/**
 * Support-ticket exact bypass — reuses resolveSupportTicketToReceiving (the
 * receiving Unbox golden path) and emits a SearchHit so header search,
 * hybridSearch, and exact_id_serial_search all resolve #4821 the same way.
 *
 * Bypass-first (no entity_search_docs SUPPORT_TICKET type): ticket-shaped
 * queries must win over numeric false-positives on receiving/repair/order ids.
 */

import { looksLikeTicketScan } from '@/lib/support/ticket-scan';
import {
  formatSupportTicketLabel,
  resolveSupportTicketToReceiving,
} from '@/lib/support/tickets';
import { searchHitHref, type SearchHit } from '@/lib/search/search-hit';
import type { OrgId } from '@/lib/tenancy/constants';
import type { GlobalSearchResult } from '@/lib/search/global-entity-search';

export interface SupportTicketSearchDeps {
  resolve: typeof resolveSupportTicketToReceiving;
}

const defaultDeps: SupportTicketSearchDeps = {
  resolve: resolveSupportTicketToReceiving,
};

/** Ticket-shaped query → GlobalSearchResult for searchAllEntities / exact arm. */
export async function searchSupportTickets(
  orgId: OrgId,
  query: string,
  deps: SupportTicketSearchDeps = defaultDeps,
): Promise<GlobalSearchResult[]> {
  if (!looksLikeTicketScan(query)) return [];
  const resolved = await deps.resolve(orgId, query).catch(() => null);
  if (!resolved) return [];
  const label = formatSupportTicketLabel(resolved.supportTicketId);
  return [
    {
      id: resolved.receivingId,
      entityType: 'receiving',
      title: `Support ticket ${label}`,
      subtitle: [
        `Receiving #${resolved.receivingId}`,
        resolved.lineId != null ? `line ${resolved.lineId}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      href: searchHitHref('RECEIVING', resolved.receivingId),
      matchField: 'support_ticket',
    },
  ];
}

/** Same resolve as SearchHit (for callers that already speak SearchHit). */
export async function resolveSupportTicketSearchHit(
  orgId: OrgId,
  query: string,
  deps: SupportTicketSearchDeps = defaultDeps,
): Promise<SearchHit | null> {
  const [hit] = await searchSupportTickets(orgId, query, deps);
  if (!hit) return null;
  return {
    ...hit,
    score: 2000,
    chips: [{ label: 'ticket', tone: 'blue' }],
  };
}
