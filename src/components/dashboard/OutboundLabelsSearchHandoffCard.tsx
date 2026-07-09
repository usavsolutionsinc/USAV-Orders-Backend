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
    <div className="rounded-2xl border border-fill-fulfillment/30 bg-fill-fulfillment/10 px-4 py-3">
      <div className="space-y-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconRight={<ChevronRight />}
          loading={isBusy}
          disabled={buttonDisabled}
          onClick={() => onOpenLabelsMatches?.(normalizedQuery)}
          className="w-full border border-fill-fulfillment/30 bg-surface-card text-text-fulfillment hover:bg-fill-fulfillment/10 hover:text-text-fulfillment disabled:border-fill-fulfillment/30 disabled:bg-fill-fulfillment/10 disabled:text-text-fulfillment"
        >
          Open Outbound Labels
        </Button>

        <div className="min-w-0">
          <p className={`${sectionLabel} text-text-fulfillment`}>Awaiting label matches</p>
          <p className="mt-1 text-caption font-semibold text-text-fulfillment">
            {isBusy ? 'Checking labels queue…' : `${labelsCount} need a carrier label`}
          </p>
          <p className="mt-1 text-micro font-semibold leading-relaxed text-text-fulfillment/80">
            Orders without tracking live on Outbound · Labels, not Unshipped.
          </p>
        </div>
      </div>
    </div>
  );
}
