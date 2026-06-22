import { Check, ExternalLink, Unlink } from '@/components/Icons';
import type { HubConfirmed } from '../types';
import { CopyableId } from './CopyableId';
import { identifierParts } from './identifier-parts';

/** A confirmed (committed) pairing row, with unpair + preview affordances. */
export function ConfirmedRow({
  confirmed,
  canonicalTitle,
  pending,
  onUnpair,
  onPreview,
  isPreviewing,
}: {
  confirmed: HubConfirmed;
  canonicalTitle: string | null;
  pending: 'accept' | 'reject' | 'unpair' | undefined;
  onUnpair: (c: HubConfirmed) => void;
  onPreview: (url: string, label: string) => void;
  isPreviewing: boolean;
}) {
  const willUnpair = pending === 'unpair';
  const { primary: value, secondary } = identifierParts(
    confirmed.platform,
    confirmed.platformSku,
    confirmed.platformItemId,
  );
  // Always show a product title. Marketplace rows (notably Ecwid) often have no
  // listing_title of their own — fall back to the canonical title.
  const rowTitle = confirmed.listingTitle?.trim() || canonicalTitle?.trim() || '';
  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
        willUnpair ? 'border-orange-200 bg-orange-50/60' : 'border-emerald-200 bg-emerald-50/40'
      }`}
    >
      <Check className={`h-3.5 w-3.5 shrink-0 ${willUnpair ? 'text-orange-500' : 'text-emerald-600'}`} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 font-mono text-xs font-bold text-gray-900">
          <CopyableId value={value} />
          {secondary ? (
            <>
              <span className="shrink-0 text-gray-400">·</span>
              <CopyableId value={secondary} />
            </>
          ) : null}
          {confirmed.accountName && (
            <span className="shrink-0 truncate text-micro font-medium uppercase tracking-wider text-gray-500">
              {confirmed.accountName}
            </span>
          )}
        </div>
        {rowTitle && <p className="truncate text-micro text-gray-500">{rowTitle}</p>}
      </div>
      {confirmed.listingUrl && (
        <button
          type="button"
          onClick={() => onPreview(confirmed.listingUrl!, confirmed.listingTitle || value)}
          className={`shrink-0 rounded p-1 transition-colors ${
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
        onClick={() => onUnpair(confirmed)}
        className={`shrink-0 rounded p-1 transition-colors ${
          willUnpair ? 'bg-orange-500 text-white hover:bg-orange-600' : 'text-gray-400 hover:bg-white hover:text-orange-600'
        }`}
        title={willUnpair ? 'Cancel unpair' : 'Unpair this mapping'}
        aria-label={willUnpair ? 'Cancel unpair' : 'Unpair'}
      >
        <Unlink className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
