import { ExternalLink, Link2, X } from '@/components/Icons';
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
        ? 'border-gray-200 bg-gray-50 opacity-60'
        : candidate.confidence >= 80
          ? 'border-amber-200 bg-amber-50/40'
          : 'border-gray-200 bg-white';

  const dotColor =
    candidate.confidence >= 80 ? 'bg-emerald-500' : candidate.confidence >= 60 ? 'bg-amber-500' : 'bg-slate-400';

  return (
    <div className={`rounded-md border px-2 py-1.5 ${tone}`}>
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-2 w-2 shrink-0 rounded-full ${dotColor}`} title={candidate.reason} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 font-mono text-xs font-bold text-gray-900">
            <CopyableId value={value} />
            {secondary ? (
              <>
                <span className="shrink-0 text-gray-400">·</span>
                <CopyableId value={secondary} />
              </>
            ) : null}
            {candidate.accountName && (
              <span className="shrink-0 truncate text-micro font-medium uppercase tracking-wider text-gray-500">
                {candidate.accountName}
              </span>
            )}
            <span className="ml-auto shrink-0 text-micro font-bold text-gray-600">{candidate.confidence}</span>
          </div>
          {rowTitle && <p className="truncate text-micro text-gray-600">{rowTitle}</p>}
          <p className="truncate text-eyebrow font-medium uppercase tracking-wider text-gray-400">{candidate.reason}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {candidate.listingUrl && (
            <button
              type="button"
              onClick={() => onPreview(candidate.listingUrl!, candidate.listingTitle || value)}
              className={`rounded p-1 transition-colors ${
                isPreviewing ? 'bg-blue-600 text-white hover:bg-blue-700' : 'text-gray-400 hover:bg-white hover:text-blue-600'
              }`}
              title={isPreviewing ? 'Showing in preview pane' : 'Preview listing below'}
              aria-label="Preview listing"
              aria-pressed={isPreviewing}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onAccept(candidate)}
            className={`rounded p-1 transition-colors ${
              pending === 'accept' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'text-gray-400 hover:bg-white hover:text-blue-600'
            }`}
            title={pending === 'accept' ? 'Will accept on save' : 'Accept this match'}
            aria-label="Accept"
          >
            <Link2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onReject(candidate)}
            className={`rounded p-1 transition-colors ${
              pending === 'reject' ? 'bg-gray-700 text-white hover:bg-gray-800' : 'text-gray-400 hover:bg-white hover:text-gray-700'
            }`}
            title={pending === 'reject' ? 'Will hide for 30 days' : 'Reject this match'}
            aria-label="Reject"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
