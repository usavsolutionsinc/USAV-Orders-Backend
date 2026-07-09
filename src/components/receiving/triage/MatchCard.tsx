'use client';

/**
 * MatchCard — one potential match in the triage Smart Matching list.
 *
 * Reusable + integration-agnostic: it renders a {@link TicketCandidate} (the
 * real return-matching surface — a customer's Zendesk claim ticket) but the
 * visual shell (eyebrow source + title + meta + right action) is generic enough
 * to host another integration's candidate later. It carries NO fabricated
 * confidence number — relevance shows through honest attributes (already-linked,
 * status, age).
 *
 * House one-row anatomy: title → meta → chips(right); selection/linked is a
 * background+ring, never a size shift.
 */

import { ExternalLink, ZendeskMark } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import {
  PairingLinkButton,
  PairingLinkedBadge,
} from '@/components/receiving/workspace/line-edit/PairingLinkButton';
import { ticketStatusTone, relativeTime, type TicketCandidate } from './triage-types';

interface MatchCardProps {
  candidate: TicketCandidate;
  /** Link this ticket to the package under triage. */
  onLink: (ticketId: number) => void;
  /** True while THIS card's link mutation is in flight. */
  linking: boolean;
  /** True while ANY link mutation is in flight (disables the others). */
  anyLinking: boolean;
}

export function MatchCard({ candidate, onLink, linking, anyLinking }: MatchCardProps) {
  const tone = ticketStatusTone(candidate.status);
  const age = relativeTime(candidate.updatedAt || candidate.createdAt);
  const linked = candidate.linkedToThis;

  return (
    <div
      className={`group rounded-xl border px-3 py-2.5 transition-colors ${
        linked
          ? 'border-emerald-300 bg-emerald-50 ring-1 ring-inset ring-emerald-400'
          : 'border-border-soft bg-surface-card hover:bg-surface-hover'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-text-soft">
          <ZendeskMark className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          {/* Eyebrow: source + ticket id */}
          <div className="flex items-center gap-1.5">
            <span className="text-eyebrow font-black uppercase tracking-widest text-text-faint">
              Zendesk
            </span>
            <span className="font-mono text-caption font-bold text-text-muted">#{candidate.id}</span>
            {candidate.url ? (
              <HoverTooltip label="Open ticket in Zendesk" focusable={false}>
                <a
                  href={candidate.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-faint hover:text-blue-500"
                  aria-label={`Open Zendesk ticket ${candidate.id}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </HoverTooltip>
            ) : null}
          </div>

          {/* Title: ticket subject */}
          <p className="mt-0.5 truncate text-caption font-bold text-text-default">
            {candidate.subject || 'Untitled ticket'}
          </p>

          {/* Meta row: status + age */}
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-eyebrow font-black uppercase tracking-widest ring-1 ring-inset ${tone.bg} ${tone.text} ${tone.ring}`}
            >
              {tone.label}
            </span>
            {age ? (
              <span className="text-eyebrow font-semibold uppercase tracking-widest text-text-faint">
                {age}
              </span>
            ) : null}
          </div>
        </div>

        {/* Right action: link / linked — shared with the other pairing tabs. */}
        <div className="shrink-0">
          {linked ? (
            <PairingLinkedBadge label="Matched" />
          ) : (
            <PairingLinkButton
              label="Match"
              loading={linking}
              disabled={anyLinking}
              onClick={() => onLink(candidate.id)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
