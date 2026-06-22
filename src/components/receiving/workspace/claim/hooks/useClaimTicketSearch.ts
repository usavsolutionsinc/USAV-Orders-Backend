import { useEffect, useState } from 'react';
import type { LinkCandidate } from '../claim-types';

export interface UseClaimTicketSearch {
  ticketQuery: string;
  setTicketQuery: (v: string) => void;
  ticketResults: LinkCandidate[];
  /** Count of matching tickets hidden because they are linked to other items. */
  hiddenLinked: number;
  searchLoading: boolean;
  selectedTicket: LinkCandidate | null;
  setSelectedTicket: React.Dispatch<React.SetStateAction<LinkCandidate | null>>;
  /** Clear the query/results — used when the modal resets on open. */
  reset: () => void;
}

interface Params {
  open: boolean;
  /** Only search while the link tab is active. */
  enabled: boolean;
  receivingId: number | null | undefined;
  lineId: number | null | undefined;
}

/**
 * Link-mode ticket search. Fetches candidate tickets — the most recent ones
 * when the box is empty (the common case: the related ticket was just filed),
 * or a Zendesk search/id lookup once the operator types. The endpoint hides
 * tickets already linked to a different item and flags ones linked to THIS
 * item, so everything returned is safe to pick. Debounced (300ms).
 *
 * Owns the result set + the current selection so a selection that falls out of
 * a refreshed result set is dropped automatically.
 */
export function useClaimTicketSearch({ open, enabled, receivingId, lineId }: Params): UseClaimTicketSearch {
  const [ticketQuery, setTicketQuery] = useState('');
  const [ticketResults, setTicketResults] = useState<LinkCandidate[]>([]);
  const [hiddenLinked, setHiddenLinked] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<LinkCandidate | null>(null);

  useEffect(() => {
    if (!open || !enabled || !receivingId) return;
    const query = ticketQuery.trim();
    const ctrl = new AbortController();
    const handle = window.setTimeout(() => {
      setSearchLoading(true);
      const params = new URLSearchParams({
        receivingId: String(receivingId),
        lineId: String(lineId),
      });
      if (query) params.set('query', query);
      fetch(`/api/receiving/zendesk-claim/link?${params}`, {
        cache: 'no-store',
        signal: ctrl.signal,
      })
        .then((r) => r.json().catch(() => null))
        .then((data) => {
          if (!data?.success) return;
          setTicketResults(Array.isArray(data.tickets) ? data.tickets : []);
          setHiddenLinked(Number(data.hiddenLinked) || 0);
          // Drop a selection that fell out of the new result set.
          setSelectedTicket((prev) =>
            prev && (data.tickets as LinkCandidate[]).some((t) => t.id === prev.id) ? prev : null,
          );
        })
        .catch(() => {
          /* best-effort — operator can refine the query */
        })
        .finally(() => setSearchLoading(false));
    }, 300);
    return () => {
      ctrl.abort();
      window.clearTimeout(handle);
    };
  }, [open, enabled, receivingId, lineId, ticketQuery]);

  const reset = () => {
    setTicketQuery('');
    setTicketResults([]);
    setHiddenLinked(0);
    setSelectedTicket(null);
  };

  return {
    ticketQuery,
    setTicketQuery,
    ticketResults,
    hiddenLinked,
    searchLoading,
    selectedTicket,
    setSelectedTicket,
    reset,
  };
}
