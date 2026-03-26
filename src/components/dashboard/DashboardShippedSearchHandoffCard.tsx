'use client';

import { ChevronRight, Loader2 } from '@/components/Icons';
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
        <button
          type="button"
          onClick={() => onOpenShippedMatches?.(normalizedQuery)}
          disabled={buttonDisabled}
          className="inline-flex w-full items-center justify-center gap-1 rounded-xl border border-blue-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-blue-100 disabled:bg-blue-50 disabled:text-blue-300"
        >
          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Open Shipped
          <ChevronRight className="h-3.5 w-3.5" />
        </button>

        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-700">
            Shipped Matches
          </p>
          <p className="mt-1 text-[11px] font-semibold text-blue-900">
            {isBusy ? 'Checking shipped results...' : `${shippedCount} found in shipped`}
          </p>
          <p className="mt-1 text-[10px] font-medium leading-relaxed text-blue-700/80">
            Open the shipped tab and keep this search text.
          </p>
        </div>
      </div>
    </div>
  );
}
