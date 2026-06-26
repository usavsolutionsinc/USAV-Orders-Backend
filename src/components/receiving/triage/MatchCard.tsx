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

import { Check, ExternalLink, Link2, Loader2, ZendeskMark } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
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
          : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
          <ZendeskMark className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          {/* Eyebrow: source + ticket id */}
          <div className="flex items-center gap-1.5">
            <span className="text-eyebrow font-black uppercase tracking-widest text-gray-400">
              Zendesk
            </span>
            <span className="font-mono text-caption font-bold text-gray-700">#{candidate.id}</span>
            {candidate.url ? (
              <HoverTooltip label="Open ticket in Zendesk" focusable={false}>
                <a
                  href={candidate.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-300 hover:text-blue-500"
                  aria-label={`Open Zendesk ticket ${candidate.id}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </HoverTooltip>
            ) : null}
          </div>

          {/* Title: ticket subject */}
          <p className="mt-0.5 truncate text-caption font-bold text-gray-900">
            {candidate.subject || 'Untitled ticket'}
          </p>

          {/* Meta row: status + age */}
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ring-1 ring-inset ${tone.bg} ${tone.text} ${tone.ring}`}
            >
              {tone.label}
            </span>
            {age ? (
              <span className="text-eyebrow font-semibold uppercase tracking-widest text-gray-400">
                {age}
              </span>
            ) : null}
          </div>
        </div>

        {/* Right action: link / linked */}
        <div className="shrink-0">
          {linked ? (
            <span className="flex items-center gap-1 rounded-lg bg-emerald-100 px-2 py-1 text-caption font-black uppercase tracking-wider text-emerald-700">
              <Check className="h-3.5 w-3.5" />
              Matched
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onLink(candidate.id)}
              disabled={anyLinking}
              className="flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-caption font-black uppercase tracking-wider text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-40"
            >
              {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              Match
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
