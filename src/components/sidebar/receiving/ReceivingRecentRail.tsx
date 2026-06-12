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
// Zoho statuses that mean "the vendor side considers this PO received". Mirror
// of the canonical server constant ZOHO_RECEIVED_LIKE_STATUSES in
// src/lib/receiving/zoho-received-reconcile.ts — inlined here because that module
// imports the DB pool and can't be pulled into a client bundle. Keep in sync.
const ZOHO_RECEIVED_LIKE = new Set(['received', 'billed', 'closed']);

export function getReceivingStatusDot(row: ReceivingLineRow): string {
  const { workflow_status: status, quantity_received: qtyReceived, quantity_expected: qtyExpected } = row;

  // Unfound cartons (no PO match) only reach this UNBOXING rail once they've been
  // unboxed — by definition they're physically in and received, so they read
  // green regardless of their EXPECTED placeholder workflow_status.
  if (row.receiving_source === 'unmatched') return 'bg-emerald-500';

  const stage = workflowStage(status);

  // Zoho is the source of truth for "received": once its PO reads
  // received/billed/closed the box is physically in, even if this line's local
  // workflow_status still sits at an earlier unbox-pipeline stage (EXPECTED /
  // MATCHED / UNBOXED) or its qty hasn't been counted yet. Show it green so a
  // Zoho-received carton can't render a mix of gray/blue/indigo "unbox" dots in
  // the rail. Terminal dispositions (failed / RTV / scrap) still win — those
  // happen after receiving and must keep their own color.
  const zohoReceived = ZOHO_RECEIVED_LIKE.has(String(row.zoho_status ?? '').trim().toLowerCase());
  if (zohoReceived && stage.phase !== 'TERMINAL') return 'bg-emerald-500';

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
  // Label with the UNBOXED time so the relative stamp matches the rail's
  // sort axis (unboxed_at DESC). A later line edit (qty bump, note, condition)
  // must NOT bump the displayed time — that's what made an old carton read
  // "8h" at the wrong spot. Fall back to line activity only for rows with no
  // unbox stamp yet (they sort last anyway).
  if (r.unboxed_at) return r.unboxed_at;
  return r.last_activity_at ?? r.updated_at ?? r.created_at;
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
    // Order by when the carton was UNBOXED (unboxed_at DESC), so this reads as
    // a "recently unboxed" feed. NOT GREATEST(unboxed_at, updated_at): that let
    // a later line edit (qty bump, note, condition) re-bump a carton unboxed
    // days ago to the top. Cartons with no unbox stamp yet sort last (NULLS
    // LAST) — they belong in History, not the unboxing rail.
    params.set('sort', 'unboxed_newest');
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
