import { ExternalLink, Link2, X } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import type { HubCandidate } from '../types';
import { CopyableId } from './CopyableId';
import { identifierParts } from './identifier-parts';

/** A ranked suggestion row, with accept/reject toggles + preview. */
export function SuggestionRow({
  candidate,
  canonicalTitle,
  pending,
  onAccept,
  onReject,
  onPreview,
  isPreviewing,
}: {
  candidate: HubCandidate;
  canonicalTitle: string | null;
  pending: 'accept' | 'reject' | 'unpair' | undefined;
  onAccept: (c: HubCandidate) => void;
  onReject: (c: HubCandidate) => void;
  onPreview: (url: string, label: string) => void;
  isPreviewing: boolean;
}) {
  const { primary: value, secondary } = identifierParts(
    candidate.platform,
    candidate.platformSku,
    candidate.platformItemId,
  );
  const rowTitle = candidate.listingTitle?.trim() || canonicalTitle?.trim() || '';
  const tone =
    pending === 'accept'
      ? 'border-blue-300 bg-blue-50'
      : pending === 'reject'
        ? 'border-border-soft bg-surface-canvas opacity-60'
        : candidate.confidence >= 80
          ? 'border-amber-200 bg-amber-50/40'
          : 'border-border-soft bg-surface-card';

  const dotColor =
    candidate.confidence >= 80 ? 'bg-emerald-500' : candidate.confidence >= 60 ? 'bg-amber-500' : 'bg-border-emphasis';

  return (
    <div className={`rounded-md border px-2 py-1.5 ${tone}`}>
      <div className="flex items-center gap-2">
        <HoverTooltip label={candidate.reason} asChild>
          <span className={`inline-flex h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
        </HoverTooltip>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 font-mono text-xs font-bold text-text-default">
            <CopyableId value={value} />
            {secondary ? (
              <>
                <span className="shrink-0 text-text-faint">·</span>
                <CopyableId value={secondary} />
              </>
            ) : null}
            {candidate.accountName && (
              <span className="shrink-0 truncate text-micro font-medium uppercase tracking-wider text-text-soft">
                {candidate.accountName}
              </span>
            )}
            <span className="ml-auto shrink-0 text-micro font-bold text-text-muted">{candidate.confidence}</span>
          </div>
          {rowTitle && <p className="truncate text-micro text-text-muted">{rowTitle}</p>}
          <p className="truncate text-eyebrow font-medium uppercase tracking-wider text-text-faint">{candidate.reason}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {candidate.listingUrl && (
            <HoverTooltip label={isPreviewing ? 'Showing in preview pane' : 'Preview listing below'} asChild>
              <button
                type="button"
                onClick={() => onPreview(candidate.listingUrl!, candidate.listingTitle || value)}
                className={`ds-raw-button rounded p-1 transition-colors ${
                  isPreviewing ? 'bg-blue-600 text-white hover:bg-blue-700' : 'text-text-faint hover:bg-surface-card hover:text-blue-600'
                }`}
                aria-label="Preview listing"
                aria-pressed={isPreviewing}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </HoverTooltip>
          )}
          <HoverTooltip label={pending === 'accept' ? 'Will accept on save' : 'Accept this match'} asChild>
            <button
              type="button"
              onClick={() => onAccept(candidate)}
              className={`ds-raw-button rounded p-1 transition-colors ${
                pending === 'accept' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'text-text-faint hover:bg-surface-card hover:text-blue-600'
              }`}
              aria-label="Accept"
            >
              <Link2 className="h-3.5 w-3.5" />
            </button>
          </HoverTooltip>
          <HoverTooltip label={pending === 'reject' ? 'Will hide for 30 days' : 'Reject this match'} asChild>
            <button
              type="button"
              onClick={() => onReject(candidate)}
              className={`ds-raw-button rounded p-1 transition-colors ${
                pending === 'reject' ? 'bg-surface-inverse-raised text-white hover:bg-surface-inverse' : 'text-text-faint hover:bg-surface-card hover:text-text-muted'
              }`}
              aria-label="Reject"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </HoverTooltip>
        </div>
      </div>
    </div>
  );
}
