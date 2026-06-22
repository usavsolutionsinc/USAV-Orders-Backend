'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { type ReceivingLineRow } from '@/components/station/receiving-line-row';
import { workflowStage, workflowStageDot } from '@/lib/receiving/workflow-stages';
import { parseStaffParam } from '@/hooks/useStaffFilter';
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

/** True when the line reads as fully received (green dot) in receiving sidebar rails. */
function isReceivingComplete(row: ReceivingLineRow): boolean {
  const { workflow_status: status, quantity_received: qtyReceived, quantity_expected: qtyExpected } = row;
  const stage = workflowStage(status);

  if (stage.phase === 'TESTING' || stage.phase === 'TERMINAL') return false;

  // Unmatched cartons are only "received" once physically unboxed — not merely
  // door-scanned (those live in triage Unfound with qty 0 / no unboxed_at).
  if (row.receiving_source === 'unmatched') {
    return (qtyReceived ?? 0) > 0 || Boolean(row.unboxed_at);
  }

  const zohoReceived = ZOHO_RECEIVED_LIKE.has(String(row.zoho_status ?? '').trim().toLowerCase());
  if (zohoReceived) return true;

  return (
    qtyExpected != null &&
    qtyExpected > 0 &&
    qtyReceived != null &&
    qtyReceived >= qtyExpected
  );
}

export function getReceivingStatusDot(row: ReceivingLineRow): string {
  const { workflow_status: status } = row;
  const stage = workflowStage(status);

  // Testing-phase items (AWAITING_TEST, IN_TEST, PASSED) always use their own
  // stage color — never override to the receiving-green. This keeps "tested"
  // visually distinct from "received" (DONE) in the rail.
  if (stage.phase === 'TESTING') return workflowStageDot(status);

  if (isReceivingComplete(row)) return 'bg-emerald-500';

  // Terminal dispositions (failed / RTV / scrap) keep their own color.
  if (stage.phase === 'TERMINAL') return workflowStageDot(status);

  return workflowStageDot(status);
}

/**
 * Hover tooltip for the rail status dot. Unboxed / Queue / Viewed are view
 * filters only — the label reflects the line's physical status, not which tab
 * you're on. Receiving pipeline: green → Received, blue family → Scanned.
 *
 * DONE is a terminal workflow stage (label "Done") but still renders an emerald
 * dot — in the receiving sidebar that reads as Received, not Done.
 */
export function getReceivingStatusDotLabel(row: ReceivingLineRow): string {
  const stage = workflowStage(row.workflow_status);

  if (stage.phase === 'TESTING') {
    return `${stage.label} — ${stage.description}`;
  }

  if (getReceivingStatusDot(row).includes('emerald')) {
    return 'Received';
  }

  if (stage.phase === 'TERMINAL') {
    return `${stage.label} — ${stage.description}`;
  }

  return 'Scanned';
}

interface Props {
  selectedLineId: number | null;
  selectedRow?: ReceivingLineRow | null;
  limit?: number;
}

/**
 * Time label for this rail's rows — MUST mirror the server's
 * `sort=unboxed_newest` axis (receiving.unboxed_at DESC) so relative times
 * read monotonically down the rail. Never fall back to last_activity_at /
 * updated_at / tested_at: those are door-scan, line-edit, or testing axes and
 * made rows jump when unrelated fields changed. Module-scope for stable
 * identity (the shell wires it into a listener effect).
 */
function getUnboxActivityAt(r: ReceivingLineRow): string | null {
  return r.unboxed_at ?? null;
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
  // Universal staff filter (P1-WORK-02): `?staff=` narrows the rail to one
  // staff (received / unboxed / first-scanned). Absent = ALL staff (default).
  const searchParams = useSearchParams();
  const staffId = parseStaffParam(searchParams.get('staff'));

  const queryKey = useMemo(
    () => ['receiving-lines-table', 'rail', 'activity', 'receive', 'unboxed_newest', staffId ?? 'all'] as const,
    [staffId],
  );

  const fetchFn = async (): Promise<ApiResponse> => {
    const params = new URLSearchParams({ limit: '500', offset: '0' });
    params.set('include', 'serials');
    if (staffId != null) params.set('staff', String(staffId));
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
      autoSelectFirstWhenEmpty
      getActivityAt={getUnboxActivityAt}
      getStatusDot={getReceivingStatusDot}
      getStatusDotLabel={getReceivingStatusDotLabel}
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
