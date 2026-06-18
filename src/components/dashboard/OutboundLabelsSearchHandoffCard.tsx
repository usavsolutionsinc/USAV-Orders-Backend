'use client';

import { ChevronRight, Loader2 } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { useOutboundLabelsSearchCount } from '@/hooks/useOutboundLabelsSearchCount';

interface OutboundLabelsSearchHandoffCardProps {
  searchQuery: string;
  onOpenLabelsMatches?: (searchQuery: string) => void;
}

/** Shown in Dashboard · Unshipped when a search may match the Outbound · Labels queue. */
export function OutboundLabelsSearchHandoffCard({
  searchQuery,
  onOpenLabelsMatches,
}: OutboundLabelsSearchHandoffCardProps) {
  const normalizedQuery = searchQuery.trim();
  const { labelsCount, isLoading, isFetching } = useOutboundLabelsSearchCount(normalizedQuery);

  if (!normalizedQuery) return null;

  const isBusy = isLoading || isFetching;
  const buttonDisabled = !onOpenLabelsMatches || isBusy || labelsCount === 0;

  return (
    <div className="rounded-2xl border border-violet-100 bg-violet-50/70 px-4 py-3">
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => onOpenLabelsMatches?.(normalizedQuery)}
          disabled={buttonDisabled}
          className={`inline-flex w-full items-center justify-center gap-1 rounded-xl border border-violet-200 bg-white px-3 py-2 ${sectionLabel} text-violet-700 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:border-violet-100 disabled:bg-violet-50 disabled:text-violet-300`}
        >
          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Open Outbound Labels
          <ChevronRight className="h-3.5 w-3.5" />
        </button>

        <div className="min-w-0">
          <p className={`${sectionLabel} text-violet-700`}>Awaiting label matches</p>
          <p className="mt-1 text-caption font-semibold text-violet-900">
            {isBusy ? 'Checking labels queue…' : `${labelsCount} need a carrier label`}
          </p>
          <p className="mt-1 text-micro font-semibold leading-relaxed text-violet-700/80">
            Orders without tracking live on Outbound · Labels, not Unshipped.
          </p>
        </div>
      </div>
    </div>
  );
}
