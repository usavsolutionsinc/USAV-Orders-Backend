'use client';

/**
 * Generic receiving rail — binds a declarative {@link ReceivingRailFeed} to the
 * shared {@link RecentActivityRailBase} display shell. This is the single piece
 * of glue every receiving-page rail flows through: it derives the query key,
 * builds the fetcher (standard or multi-source), and resolves the quantity +
 * status-dot strategies from the registries. No new display — the row anatomy,
 * popover, skeleton, grouping, and keyboard nav all live in the base shell.
 *
 * The named rail components (ReceivingRecentRail / ReceivingScannedRail /
 * ReceivingViewedRail / TriageCombinedList / TriageUnfoundList) are now thin
 * bindings around this, kept as stable seams to diverge later if a single
 * surface needs to.
 */

import { useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import { parseStaffParam } from '@/hooks/useStaffFilter';
import { RecentActivityRailBase, type ApiResponse } from './RecentActivityRailBase';
import { useRailExclusions } from './useRailExclusions';
import { railExclusionFeedKey } from '@/lib/receiving/rail/exclusion-feed-key';
import {
  RECEIVING_RAIL_FEEDS,
  fetchReceivingLines,
  type RailFetchRuntime,
  type ReceivingRailFeedId,
} from '@/lib/receiving/rail/feeds';
import { stampPoRailTitleContext } from '@/lib/receiving/po-group-title';
import { RAIL_QTY } from '@/lib/receiving/rail/quantity';
import { RAIL_STATUS } from '@/lib/receiving/rail/status';

interface ReceivingFeedRailProps {
  /** Which feed to render — the registry key (`"unboxRecent"`, `"scanned"`, …). */
  feed: ReceivingRailFeedId;
  selectedLineId: number | null;
  selectedRow?: ReceivingLineRow | null;
  /** Optimistic row pinned at the top until its real row lands (triage importing stub). */
  leadingRow?: ReceivingLineRow | null;
  getRowDisabled?: (row: ReceivingLineRow) => boolean;
  /**
   * Cache scope for feeds that mount in more than one mode (the Scanned feed is
   * the unbox Queue AND the triage Prioritize) — keeps each mode's cache entry
   * distinct so one mode's in-flight/stale rows can't flash into the other.
   */
  scope?: string;
  /** Desktop search text (filters the feed's rows). */
  filterText?: string;
  /** Optional read-only context node under the popover badges (e.g. unfound exception dot). */
  renderPopoverContext?: (row: ReceivingLineRow) => ReactNode;
  /** Optional popover footer action, left of "Open →" (e.g. unfound "Claim"). */
  renderPopoverActions?: (row: ReceivingLineRow, ctx: { dismiss: () => void }) => ReactNode;
}

export function ReceivingFeedRail({
  feed: feedId,
  selectedLineId,
  selectedRow = null,
  leadingRow = null,
  getRowDisabled,
  scope,
  filterText = '',
  renderPopoverContext,
  renderPopoverActions,
}: ReceivingFeedRailProps) {
  const feed = RECEIVING_RAIL_FEEDS[feedId];
  // Hook must run unconditionally; the value is only USED when the feed opts in.
  const searchParams = useSearchParams();
  const staffId = feed.usesStaffFilter ? parseStaffParam(searchParams.get('staff')) : null;
  const q = filterText.trim().toLowerCase();

  // Phase 4 read filter: this staffer's dismissed rows for the feed
  // (staff_rail_exclusions, keyed by rail id = row.id). A stable signature of the
  // set rides the queryKey so a change (fresh load, a new dismiss) forces a
  // filtered refetch instead of serving stale unfiltered cache.
  const exclusionFeedKey = railExclusionFeedKey(feedId, scope);
  const excluded = useRailExclusions(exclusionFeedKey);
  const excludedSig = useMemo(() => Array.from(excluded).sort((a, b) => a - b).join(','), [excluded]);

  // Distinct, isolated cache entry per feed/scope/staff/query/exclusion-set —
  // still under the ['receiving-lines-table'] prefix so broad invalidations refresh it.
  const queryKey = useMemo(
    () =>
      ['receiving-lines-table', 'rail', feed.segment, scope ?? 'default', q, staffId ?? 'all', excludedSig] as const,
    [feed.segment, scope, q, staffId, excludedSig],
  );

  const rt: RailFetchRuntime = { staffId, query: q };
  const baseFetchFn = feed.buildFetcher
    ? feed.buildFetcher(rt)
    : () =>
        fetchReceivingLines(
          { segment: feed.segment, view: feed.view!, sort: feed.sort, postFilter: feed.postFilter },
          rt,
        );

  // Strictly additive — an empty exclusion set returns the fetched rows untouched.
  const fetchFn = useMemo<() => Promise<ApiResponse>>(() => {
    const applyTitleContext = (data: ApiResponse): ApiResponse => {
      if (feed.stampRailTitleContext !== 'po') return data;
      const rows = stampPoRailTitleContext(data.receiving_lines ?? []);
      return { ...data, receiving_lines: rows, total: rows.length };
    };
    if (excluded.size === 0) {
      return async () => applyTitleContext(await baseFetchFn());
    }
    return async () => {
      const data = await baseFetchFn();
      const rows = (data.receiving_lines ?? []).filter((r) => !excluded.has(r.id));
      return applyTitleContext({ ...data, receiving_lines: rows, total: rows.length });
    };
    // baseFetchFn is rebuilt each render from rt (staffId/query); the stable
    // inputs (+ excludedSig) below track a real fetch-shape change (baseFetchFn
    // itself is intentionally omitted — it has a new identity every render).
  }, [excluded, excludedSig, feed.segment, feed.stampRailTitleContext, scope, q, staffId]);

  const qty = RAIL_QTY[feed.qty];
  const dot = RAIL_STATUS[feed.status];

  return (
    <RecentActivityRailBase
      selectedLineId={selectedLineId}
      selectedRow={selectedRow}
      leadingRow={leadingRow}
      getRowDisabled={getRowDisabled}
      limit={feed.limit ?? 25}
      queryKey={queryKey}
      fetchFn={fetchFn}
      updateEvent="receiving-line-updated"
      deleteEvent="receiving-line-deleted"
      deleteGroupEvent="receiving-entry-deleted"
      refreshEvents={feed.refreshEvents}
      // Workspace header chevrons (`LineEditToolbar`) dispatch this channel —
      // same contract as TestingRecentRail ↔ testing-navigate-rail. Without it
      // unbox/triage prev/next are a no-op (the history table listens on the
      // same name but its rows aren't the rail's PO list).
      navigateEvent="receiving-navigate-table"
      eyebrowTitle={feed.eyebrowTitle}
      autoSelectFirstWhenEmpty={feed.autoSelectFirstWhenEmpty}
      pinSelectedLead={feed.pinSelectedLead}
      getActivityAt={feed.getActivityAt}
      getStatusDot={dot.getStatusDot}
      getStatusDotLabel={dot.getStatusDotLabel}
      renderQuantity={qty.renderQuantity}
      previewQtyLabel={qty.previewQtyLabel}
      getPreviewQty={qty.getPreviewQty}
      renderPopoverContext={renderPopoverContext}
      renderPopoverActions={renderPopoverActions}
      rowTitleMode={feed.rowTitleMode}
    />
  );
}
