'use client';

import { useMemo } from 'react';
import { type ReceivingLineRow } from '@/components/station/receiving-line-row';
import { workflowStage, workflowStageDot } from '@/lib/receiving/workflow-stages';
import { RecentActivityRailBase, type ApiResponse } from './RecentActivityRailBase';

/**
 * Color logic for the left status dot in Testing view. Colors come straight
 * from the shared lifecycle registry (workflow-stages.ts) so the testing flow
 * (awaiting → in-test → passed/failed) reads with the same per-stage hues as
 * everywhere else, rather than collapsing receipt states into one blue bucket.
 */
export function getTestingStatusDot(row: ReceivingLineRow): string {
  return workflowStageDot(row.workflow_status);
}

function getTestingStatusDotLabel(row: ReceivingLineRow): string {
  const stage = workflowStage(row.workflow_status);
  return `${stage.label} — ${stage.description}`;
}

/** Full invalidation triggers — module-scope so the shell's refresh-listener
 * effect keeps a stable identity and subscribes once (a fresh array literal each
 * render made it re-subscribe, risking a dropped event mid-swap). */
// Full-invalidation triggers for the testing TO-DO feed. A unit ENTERS the
// needs-test set on receive (`receiving-entry-added` from a tracking scan,
// `receiving-serial-scanned` when a serial is captured during unbox) and LEAVES
// it on a recorded verdict (`testing-result-recorded`) — all of which add/remove
// rows, so the feed must refetch rather than merely patch in place. The receive
// events are exactly how acceptance B (live updates as units are received) is met.
const TESTING_REFRESH_EVENTS = [
  'receiving-entry-added',
  'receiving-serial-scanned',
  'usav-refresh-data',
  'testing-result-recorded',
];

/**
 * Computes "Tested" quantity for a line in the Testing feed. Prefers the real
 * recorded-verdict count from the API (`tested_count`, scoped to this tester);
 * a line with verdicts but a non-terminal workflow_status (e.g. partway through
 * a multi-unit line, or still IN_TEST) then reads "k/N" instead of a misleading
 * "0/N". Falls back to the terminal-status heuristic for feeds/rows that don't
 * carry tested_count (the no-tester activity fallback, older cached rows).
 */
function getTestedQty(row: ReceivingLineRow): number {
  if (typeof row.tested_count === 'number') {
    return Math.min(row.tested_count, row.quantity_received);
  }
  const v = String(row.workflow_status || '').trim().toUpperCase();
  const isTested = ['PASSED', 'DONE', 'FAILED', 'SCRAP', 'RTV'].some(s => v.startsWith(s));
  return isTested ? row.quantity_received : 0;
}

interface Props {
  selectedLineId: number | null;
  selectedRow?: ReceivingLineRow | null;
  limit?: number;
  /**
   * When set, the rail shows ONLY items this staff member has recently tested
   * (from the testing_results log, newest verdict first). When null it falls
   * back to the shared touched-activity feed.
   */
  testerId?: number | null;
}

/**
 * Sidebar "Recent activity" rail for the Testing workspace.
 * Uses RecentActivityRailBase as a shell with Testing-specific logic.
 */
export function TestingRecentRail({
  selectedLineId,
  selectedRow = null,
  // Cap the rendered feed at 25 (matches the Receiving rail). The fetch still
  // pulls up to 500 for selection-pinning, but only the 25 most-recent verdicts
  // render; the sidebar's overflow-y-auto container scrolls within that.
  limit = 25,
  testerId = null,
}: Props) {
  const hasTester = Number.isFinite(testerId) && (testerId as number) > 0;

  // 'rail' segment keeps this DISTINCT from the main ReceivingLinesTable keys —
  // the table caches the full ApiResponse object under
  // ['receiving-lines-table', <view>, 'receive'|...], while the rail caches the
  // bare receiving_lines array. Sharing a key feeds one query the other's shape
  // (→ "allRows.slice is not a function"). Still under the
  // ['receiving-lines-table'] prefix so broad invalidations refresh it. The
  // tester segment keeps each staff member's feed in its own cache slot.
  const queryKey = useMemo(
    () => ['receiving-lines-table', 'rail', 'needs-test', String(testerId ?? 'all')] as const,
    [testerId],
  );

  const fetchFn = async (): Promise<ApiResponse> => {
    const params = new URLSearchParams({ limit: '500', offset: '0' });
    params.set('include', 'serials');
    // P1-PCK-03: the testing to-do DEFAULTS to recently-received units awaiting
    // test — newest-received first (server orders view=needs-test by unbox/
    // receive time DESC), so freshly-unboxed units surface at the top for
    // real-time pickup. When a tech identity is known we scope to that tech's
    // own assignments; otherwise the all-staff needs-test queue.
    params.set('view', 'needs-test');
    if (hasTester) params.set('tester', String(testerId));
    const res = await fetch(`/api/receiving-lines?${params.toString()}`);
    if (!res.ok) throw new Error('fetch failed');
    return res.json();
  };

  return (
    <RecentActivityRailBase
      selectedLineId={selectedLineId}
      selectedRow={selectedRow}
      limit={limit}
      queryKey={queryKey}
      fetchFn={fetchFn}
      updateEvent="receiving-line-updated"
      refreshEvents={TESTING_REFRESH_EVENTS}
      navigateEvent="testing-navigate-rail"
      eyebrowTitle="To Test"
      eyebrowSuffix={hasTester ? 'Your Queue' : 'Newest Received'}
      getStatusDot={getTestingStatusDot}
      getStatusDotLabel={getTestingStatusDotLabel}
      renderQuantity={(row) => {
        const tested = getTestedQty(row);
        const received = row.quantity_received;
        return (
          <span className={tested >= received && received > 0 ? 'text-emerald-600' : 'text-gray-600'}>
            {tested}/{received}
          </span>
        );
      }}
      previewQtyLabel="Tested"
      getPreviewQty={(row) => ({
        current: getTestedQty(row),
        total: row.quantity_received,
      })}
    />
  );
}
