import { Check, ExternalLink, Unlink } from '@/components/Icons';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { IconButton } from '@/design-system/primitives';
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
        <div className="flex min-w-0 items-center gap-1.5 font-mono text-xs font-bold text-text-default">
          <CopyableId value={value} />
          {secondary ? (
            <>
              <span className="shrink-0 text-text-faint">·</span>
              <CopyableId value={secondary} />
            </>
          ) : null}
          {confirmed.accountName && (
            <span className="shrink-0 truncate text-micro font-medium uppercase tracking-wider text-text-soft">
              {confirmed.accountName}
            </span>
          )}
        </div>
        {rowTitle && <p className="truncate text-micro text-text-soft">{rowTitle}</p>}
      </div>
      {confirmed.listingUrl && (
        <HoverTooltip label={isPreviewing ? 'Showing in preview pane' : 'Preview listing below'} asChild>
          <IconButton
            icon={<ExternalLink className="h-3.5 w-3.5" />}
            ariaLabel="Preview listing"
            aria-pressed={isPreviewing}
            tone="accent"
            onClick={() => onPreview(confirmed.listingUrl!, confirmed.listingTitle || value)}
            className={`shrink-0 rounded p-1 ${
              isPreviewing ? 'bg-blue-600 text-white hover:bg-blue-700' : 'hover:bg-surface-card'
            }`}
          />
        </HoverTooltip>
      )}
      <HoverTooltip label={willUnpair ? 'Cancel unpair' : 'Unpair this mapping'} asChild>
        <IconButton
          icon={<Unlink className="h-3.5 w-3.5" />}
          ariaLabel={willUnpair ? 'Cancel unpair' : 'Unpair'}
          onClick={() => onUnpair(confirmed)}
          className={`shrink-0 rounded p-1 ${
            willUnpair ? 'bg-orange-500 text-white hover:bg-orange-600' : 'text-text-faint hover:bg-surface-card hover:text-orange-600'
          }`}
        />
      </HoverTooltip>
    </div>
  );
}
