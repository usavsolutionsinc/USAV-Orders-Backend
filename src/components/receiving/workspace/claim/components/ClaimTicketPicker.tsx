import { Loader2 } from '@/components/Icons';
import { statusBadge } from '@/components/support/zendesk/badges';
import { ticketDate } from '../claim-helpers';
import type { LinkCandidate } from '../claim-types';
import type { UseClaimTicketSearch } from '../hooks/useClaimTicketSearch';

interface Props {
  search: UseClaimTicketSearch;
  onSelect: (t: LinkCandidate | null) => void;
}

/** Link-mode search box + results list (recent tickets when the box is empty). */
export function ClaimTicketPicker({ search, onSelect }: Props) {
  const { ticketQuery, setTicketQuery, ticketResults, hiddenLinked, searchLoading, selectedTicket } = search;
  const hasQuery = !!ticketQuery.trim();

  return (
    <>
      <div>
        <label
          htmlFor="claim-ticket-search"
          className="mb-1.5 block text-micro font-black uppercase tracking-[0.14em] text-text-soft"
        >
          Pick the existing ticket
        </label>
        <input
          id="claim-ticket-search"
          type="text"
          value={ticketQuery}
          onChange={(e) => setTicketQuery(e.target.value)}
          placeholder="Search by subject, or paste a ticket # (e.g. #12345)"
          autoFocus
          className="block w-full rounded-lg border border-border-soft bg-surface-card px-3 py-2 text-label font-medium text-text-default outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <p className="text-micro font-black uppercase tracking-[0.14em] text-text-soft">
            {hasQuery ? 'Results' : 'Recent tickets'} — click to select
          </p>
          {searchLoading ? <Loader2 className="h-3 w-3 animate-spin text-text-faint" /> : null}
        </div>
        <div className="max-h-[280px] overflow-y-auto rounded-xl border border-border-soft bg-surface-card">
          {ticketResults.length > 0 ? (
            <div className={searchLoading ? 'opacity-50' : ''}>
              {ticketResults.map((t) => {
                const isSel = selectedTicket?.id === t.id;
                const badge = statusBadge(t.status);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onSelect(isSel ? null : t)}
                    disabled={t.linkedToThis}
                    className={`ds-raw-button flex w-full items-center gap-2.5 border-b border-border-hairline px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                      isSel ? 'bg-rose-50' : 'hover:bg-surface-hover'
                    } ${t.linkedToThis ? 'cursor-default opacity-60' : ''}`}
                  >
                    <span className="shrink-0 font-mono text-caption font-bold text-text-default">#{t.id}</span>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-wider ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-label font-medium text-text-muted">
                      {t.subject || '—'}
                    </span>
                    <span className="shrink-0 text-micro font-medium text-text-faint">
                      {ticketDate(t.updatedAt)}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : searchLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-micro font-semibold text-text-faint">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching…
            </div>
          ) : (
            <div className="px-4 py-10 text-center text-micro font-medium text-text-faint">
              {hasQuery
                ? 'No tickets found — try a different search or ticket #'
                : 'Recent Zendesk tickets will appear here'}
            </div>
          )}
        </div>
      </div>

      {hiddenLinked > 0 ? (
        <p className="text-micro font-medium text-text-faint">
          {hiddenLinked} matching ticket{hiddenLinked === 1 ? ' is' : 's are'} hidden — already linked
          to other items.
        </p>
      ) : null}
    </>
  );
}
