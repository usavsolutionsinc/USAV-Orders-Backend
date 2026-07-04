'use client';

import { Loader2 } from '@/components/Icons';
import DateRangeHeader from '@/components/ui/DateRangeHeader';
import { ColumnConfigButton } from '@/components/ui/table-column-config/ColumnConfigButton';
import { PaneHeader } from '@/components/ui/pane-header';
import { sectionLabel, fieldLabel } from '@/design-system/tokens/typography/presets';
import { mainStickyHeaderClass, mainStickyHeaderRowClass } from '@/components/layout/header-shell';
import { getWeekRangeForOffset } from '@/lib/dashboard-week-range';
import type { ShippedPeriodControls } from './useShippedPeriodControls';

export interface ShippedTableHeaderProps {
  bannerTitle?: React.ReactNode;
  bannerSubtitle?: React.ReactNode;
  /** Show the refresh spinner (background fetch / search resolving). */
  isBusy: boolean;
  /** Render the compact "N results" header (active search or carrier filter). */
  showResultsHeader: boolean;
  totalCount: number;
  weekRange: ReturnType<typeof getWeekRangeForOffset>;
  /** Week/month/custom period picker controls (presets + custom range + reset). */
  period: ShippedPeriodControls;
}

const BusySpinner = ({ isBusy }: { isBusy: boolean }) => (
  <div className="min-w-[18px] flex items-center justify-end">
    {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" /> : null}
  </div>
);

/**
 * The shipped table's sticky header. One of three modes:
 * - a labelled banner (when `bannerTitle` is set),
 * - a "N results" {@link PaneHeader} (active search / carrier filter),
 * - the default {@link DateRangeHeader}: a pill date+filter picker (week / month
 *   / custom range) on the left, the columns icon pinned top-right.
 */
export function ShippedTableHeader({
  bannerTitle,
  bannerSubtitle,
  isBusy,
  showResultsHeader,
  totalCount,
  weekRange,
  period,
}: ShippedTableHeaderProps) {
  if (bannerTitle) {
    return (
      <div className={mainStickyHeaderClass}>
        <div className={mainStickyHeaderRowClass}>
          <div>
            <p className={`${sectionLabel} text-blue-700`}>{bannerTitle}</p>
            {bannerSubtitle ? <p className={`mt-0.5 ${fieldLabel}`}>{bannerSubtitle}</p> : null}
          </div>
          <BusySpinner isBusy={isBusy} />
        </div>
      </div>
    );
  }

  if (showResultsHeader) {
    // Render through PaneHeader with the SAME class overrides WeekHeader uses
    // (border-b-0 shell + gray-300 row divider) so the search-results header is
    // pixel-identical chrome to every other table header — same 40px height,
    // padding, and divider weight.
    return (
      <PaneHeader
        className="border-b-0"
        rowClassName="border-b border-border-default"
        leftSlot={
          <p className={`${sectionLabel} text-text-muted`}>{totalCount} result{totalCount !== 1 ? 's' : ''}</p>
        }
        rightSlot={<BusySpinner isBusy={isBusy} />}
      />
    );
  }

  return (
    <DateRangeHeader
      count={totalCount}
      weekRange={weekRange}
      activeRange={period.activeRange}
      presets={period.presets}
      onSelectCustomRange={period.onSelectCustomRange}
      onClear={period.onClear}
      columns={<ColumnConfigButton iconOnly />}
    />
  );
}
