'use client';

import { useMemo, useState } from 'react';
import { type ReceivingLineRow } from '@/components/station/receiving-line-row';
import { workflowStage, workflowStageDot } from '@/lib/receiving/workflow-stages';
import { RecentActivityRailBase, type ApiResponse } from './RecentActivityRailBase';
import { TestingRailFeedToggle, type TestingRailFeed } from './TestingRailFeedToggle';

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
  // Short lifecycle label only — the old `${label} — ${description}` form wrapped
  // into a full-width banner in the hover popover badge. DONE is the terminal
  // "finalized" stage, but operator-facing it reads as "Received" (matching the
  // receiving rails + workflowStatusTableLabel's DONE → RECEIVED), never "Done".
  if (stage.status === 'DONE') return 'Received';
  return stage.label;
}

/** Full invalidation triggers — module-scope so the shell's refresh-listener
 * effect keeps a stable identity and subscribes once (a fresh array literal each
 * render made it re-subscribe, risking a dropped event mid-swap). */
const TESTING_QUEUE_REFRESH_EVENTS = [
  'receiving-entry-added',
  'receiving-serial-scanned',
  'usav-refresh-data',
  'testing-result-recorded',
];

const TESTING_TESTED_REFRESH_EVENTS = [
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
  /** Scopes both feeds to this staff member when set (queue → assignments, tested → verdicts). */
  testerId?: number | null;
}

/**
 * Sidebar activity rail for the Testing workspace. A sticky pill toggle switches
 * between the recently-tested log (`view=testing`, default) and the needs-test
 * queue (`view=needs-test`, backed by assignments).
 */
export function TestingRecentRail({
  selectedLineId,
  selectedRow = null,
  limit = 25,
  testerId = null,
}: Props) {
  const [feed, setFeed] = useState<TestingRailFeed>('tested');
  const hasTester = Number.isFinite(testerId) && (testerId as number) > 0;
  const isQueue = feed === 'queue';

  const queryKey = useMemo(
    () => ['receiving-lines-table', 'rail', feed, String(testerId ?? 'all')] as const,
    [feed, testerId],
  );

  const fetchFn = async (): Promise<ApiResponse> => {
    const params = new URLSearchParams({ limit: '500', offset: '0' });
    params.set('include', 'serials');
    params.set('view', isQueue ? 'needs-test' : 'testing');
    if (hasTester) params.set('tester', String(testerId));
    const res = await fetch(`/api/receiving-lines?${params.toString()}`);
    if (!res.ok) throw new Error('fetch failed');
    return res.json();
  };

  return (
    <>
      <TestingRailFeedToggle value={feed} onChange={setFeed} />
      <RecentActivityRailBase
        selectedLineId={selectedLineId}
        selectedRow={selectedRow}
        limit={limit}
        queryKey={queryKey}
        fetchFn={fetchFn}
        updateEvent="receiving-line-updated"
        refreshEvents={isQueue ? TESTING_QUEUE_REFRESH_EVENTS : TESTING_TESTED_REFRESH_EVENTS}
        navigateEvent="testing-navigate-rail"
        eyebrowTitle={isQueue ? 'To Test' : 'Tested'}
        eyebrowSuffix={
          isQueue
            ? (hasTester ? 'Your Queue' : 'Newest Received')
            : (hasTester ? 'Your Verdicts' : 'All Staff')
        }
        getStatusDot={getTestingStatusDot}
        getStatusDotLabel={getTestingStatusDotLabel}
        renderQuantity={(row) => {
          const tested = getTestedQty(row);
          const received = row.quantity_received;
          return (
            <span className={tested >= received && received > 0 ? 'text-emerald-600' : 'text-text-muted'}>
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
    </>
  );
}
