'use client';

import { useMemo } from 'react';
import { type ReceivingLineRow } from '@/components/station/ReceivingLinesTable';
import { workflowStage, workflowStageDot } from '@/lib/receiving/workflow-stages';
import { RecentActivityRailBase, type ApiResponse } from './RecentActivityRailBase';

/**
 * Color logic for the left status dot in Receiving view. Colors come from the
 * shared lifecycle registry (workflow-stages.ts) so the dot, the badge, and
 * every other surface agree. The one receiving-specific override: a line whose
 * received qty has met expected reads green even if the workflow hasn't been
 * advanced yet — "fully in" is the signal receivers scan for.
 */
export function getReceivingStatusDot(row: ReceivingLineRow): string {
  const { workflow_status: status, quantity_received: qtyReceived, quantity_expected: qtyExpected } = row;

  // Unfound cartons (no PO match) only reach this UNBOXING rail once they've been
  // unboxed — by definition they're physically in and received, so they read
  // green regardless of their EXPECTED placeholder workflow_status.
  if (row.receiving_source === 'unmatched') return 'bg-emerald-500';

  const stage = workflowStage(status);
  const qtyComplete =
    qtyExpected != null && qtyExpected > 0 && qtyReceived != null && qtyReceived >= qtyExpected;

  // Fully received but not in a terminal-fail state → green completeness cue.
  if (qtyComplete && stage.phase !== 'TERMINAL') return 'bg-emerald-500';
  return workflowStageDot(status);
}

interface Props {
  selectedLineId: number | null;
  selectedRow?: ReceivingLineRow | null;
  limit?: number;
}

/**
 * Time label for this rail's rows — MUST mirror the server's
 * `sort=unbox_activity` axis (max of unboxed_at / line updated_at) so the
 * relative times read monotonically down the rail. The base accessor reads
 * `last_activity_at`, which is door-scan based: sorting by unbox activity
 * while labeling with scan time made a carton unboxed weeks ago but
 * re-scanned today show "8h" at the BOTTOM of the rail. Module-scope for
 * stable identity (the shell wires it into a listener effect).
 */
function getUnboxActivityAt(r: ReceivingLineRow): string | null {
  const stamps = [r.unboxed_at, r.updated_at]
    .map((raw) => (raw ? { raw, t: new Date(raw).getTime() } : null))
    .filter((x): x is { raw: string; t: number } => x != null && Number.isFinite(x.t));
  if (stamps.length === 0) return r.last_activity_at ?? r.created_at;
  return stamps.sort((a, b) => b.t - a.t)[0].raw;
}

/**
 * Sidebar "Recent activity" rail for the Receiving workspace.
 * Uses RecentActivityRailBase as a shell with Receiving-specific logic.
 */
export function ReceivingRecentRail({
  selectedLineId,
  selectedRow = null,
  limit = 25,
}: Props) {
  // 'rail' segment keeps this DISTINCT from ReceivingLinesTable's
  // ['receiving-lines-table', 'all', 'receive'] key (which caches the full
  // ApiResponse object, not the array) so the two queries can't share a cache
  // entry and feed each other the wrong shape. Still under the
  // ['receiving-lines-table'] prefix so broad invalidations refresh it.
  const queryKey = useMemo(() => ['receiving-lines-table', 'rail', 'activity', 'receive'] as const, []);

  const fetchFn = async (): Promise<ApiResponse> => {
    const params = new URLSearchParams({ limit: '500', offset: '0' });
    params.set('include', 'serials');
    // 'activity' = the UNBOXING pipeline only: lines that have been unboxed /
    // received (qty > 0, workflow past MATCHED, or an unbox timestamp). Cartons
    // merely scanned at the door (phone /m/receive or desktop "mark scanned")
    // are excluded — they live in History, not this rail, which drives the
    // unboxing workspace (LineEditPanel).
    params.set('view', 'activity');
    // Order by unbox-pipeline activity (unboxed_at OR the line's last write),
    // NOT scan-based last activity — a door re-scan in triage bumps neither,
    // so triage scans can't reorder this rail, while a return-paired /
    // just-received carton with no unbox stamp yet still surfaces by its
    // line activity instead of sinking past the render window.
    params.set('sort', 'unbox_activity');
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
      deleteEvent="receiving-line-deleted"
      deleteGroupEvent="receiving-entry-deleted"
      refreshEvents={['receiving-entry-added', 'receiving-entry-deleted', 'usav-refresh-data']}
      eyebrowTitle="Recent"
      eyebrowSuffix="Unboxing"
      autoSelectFirstWhenEmpty
      getActivityAt={getUnboxActivityAt}
      getStatusDot={getReceivingStatusDot}
      renderQuantity={(row) => (
        <span className={
          row.quantity_expected != null && row.quantity_received >= row.quantity_expected 
            ? 'text-emerald-600' 
            : 'text-gray-600'
        }>
          {row.quantity_received}/{row.quantity_expected ?? '?'}
        </span>
      )}
      previewQtyLabel="Received"
      getPreviewQty={(row) => ({
        current: row.quantity_received,
        total: row.quantity_expected,
      })}
    />
  );
}
