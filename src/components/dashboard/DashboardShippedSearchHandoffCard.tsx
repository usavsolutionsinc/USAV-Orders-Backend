'use client';

import { ChevronRight } from '@/components/Icons';
import { Button } from '@/design-system/primitives';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { useDashboardShippedSearchCount } from '@/hooks/useDashboardShippedSearchCount';

interface DashboardShippedSearchHandoffCardProps {
  searchQuery: string;
  onOpenShippedMatches?: (searchQuery: string) => void;
}

export function DashboardShippedSearchHandoffCard({
  searchQuery,
  onOpenShippedMatches,
}: DashboardShippedSearchHandoffCardProps) {
  const normalizedQuery = searchQuery.trim();
  const { shippedCount, isLoading, isFetching } = useDashboardShippedSearchCount(normalizedQuery);

  if (!normalizedQuery) return null;

  const isBusy = isLoading || isFetching;
  const buttonDisabled = !onOpenShippedMatches || isBusy || shippedCount === 0;

  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3">
      <div className="space-y-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onOpenShippedMatches?.(normalizedQuery)}
          disabled={buttonDisabled}
          loading={isBusy}
          iconRight={<ChevronRight />}
          className={`w-full justify-center rounded-xl border border-blue-200 bg-white px-3 py-2 ring-0 ${sectionLabel} text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-blue-100 disabled:bg-blue-50 disabled:text-blue-300`}
        >
          Open Shipped
        </Button>

        <div className="min-w-0">
          <p className={`${sectionLabel} text-blue-700`}>
            Shipped Matches
          </p>
          <p className="mt-1 text-caption font-semibold text-blue-900">
            {isBusy ? 'Checking shipped results...' : `${shippedCount} found in shipped`}
          </p>
          <p className="mt-1 text-micro font-semibold leading-relaxed text-blue-700/80">
            Open the shipped tab and keep this search text.
          </p>
        </div>
      </div>
    </div>
  );
}
