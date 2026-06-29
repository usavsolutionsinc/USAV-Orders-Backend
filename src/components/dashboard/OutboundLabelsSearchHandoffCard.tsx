'use client';

import { ChevronRight } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconRight={<ChevronRight />}
          loading={isBusy}
          disabled={buttonDisabled}
          onClick={() => onOpenLabelsMatches?.(normalizedQuery)}
          className="w-full border border-violet-200 bg-white text-violet-700 hover:bg-violet-100 hover:text-violet-700 disabled:border-violet-100 disabled:bg-violet-50 disabled:text-violet-300"
        >
          Open Outbound Labels
        </Button>

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
