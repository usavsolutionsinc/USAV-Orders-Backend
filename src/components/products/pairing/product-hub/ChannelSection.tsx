import { useState } from 'react';
import { ChevronDown } from '@/components/Icons';
import { platformStyle } from '../platform-style';
import type { HubCandidate, HubConfirmed } from '../types';
import { ConfirmedRow } from './ConfirmedRow';
import { SuggestionRow } from './SuggestionRow';
import { ChannelManualAdd } from './ChannelManualAdd';

/** One platform's section: confirmed pairings + ranked suggestions + manual add. */
export function ChannelSection({
  platform,
  confirmed,
  suggestions,
  canonicalTitle,
  skuCatalogId,
  onAdded,
  pendingByRowId,
  onAccept,
  onReject,
  onUnpair,
  onPreview,
  activePreviewUrl,
}: {
  platform: string;
  confirmed: HubConfirmed[];
  suggestions: HubCandidate[];
  canonicalTitle: string | null;
  skuCatalogId: number;
  onAdded: () => void;
  pendingByRowId: Map<number, { kind: 'accept' | 'reject' | 'unpair' }>;
  onAccept: (c: HubCandidate) => void;
  onReject: (c: HubCandidate) => void;
  onUnpair: (c: HubConfirmed) => void;
  onPreview: (url: string, label: string) => void;
  activePreviewUrl: string | null;
}) {
  const style = platformStyle(platform);
  const [showAll, setShowAll] = useState(false);

  if (confirmed.length === 0 && suggestions.length === 0) {
    return (
      <section className={`border-l-2 py-2 pl-3 ${style.ring}`}>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wider ${style.chip}`}>
            {style.label}
          </span>
          <span className="text-micro text-gray-400">empty</span>
        </div>
        <ChannelManualAdd platform={platform} skuCatalogId={skuCatalogId} onAdded={onAdded} />
      </section>
    );
  }

  const visibleSuggestions = showAll ? suggestions : suggestions.slice(0, 1);
  const moreCount = suggestions.length - visibleSuggestions.length;

  return (
    <section className={`border-l-2 py-2 pl-3 ${style.ring}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wider ${style.chip}`}>
          {style.label}
        </span>
      </div>

      <div className="space-y-1">
        {confirmed.map((c) => (
          <ConfirmedRow
            key={`c-${c.platformIdRowId}`}
            confirmed={c}
            canonicalTitle={canonicalTitle}
            pending={pendingByRowId.get(c.platformIdRowId)?.kind}
            onUnpair={onUnpair}
            onPreview={onPreview}
            isPreviewing={!!c.listingUrl && c.listingUrl === activePreviewUrl}
          />
        ))}
        {visibleSuggestions.map((c) => (
          <SuggestionRow
            key={`s-${c.platformIdRowId}`}
            candidate={c}
            canonicalTitle={canonicalTitle}
            pending={pendingByRowId.get(c.platformIdRowId)?.kind}
            onAccept={onAccept}
            onReject={onReject}
            onPreview={onPreview}
            isPreviewing={!!c.listingUrl && c.listingUrl === activePreviewUrl}
          />
        ))}
      </div>

      {!showAll && moreCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-1.5 inline-flex items-center gap-1 text-micro font-semibold uppercase tracking-wider text-blue-600 hover:text-blue-800"
        >
          See {moreCount} more <ChevronDown className="h-3 w-3" />
        </button>
      )}

      <ChannelManualAdd platform={platform} skuCatalogId={skuCatalogId} onAdded={onAdded} />
    </section>
  );
}
