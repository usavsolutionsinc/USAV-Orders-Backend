/**
 * Pure helpers, types, and event dispatchers shared by the receiving-lines
 * table and its sub-hooks/components. Extracted from the 1,400-line
 * `ReceivingLinesTable.tsx` so the data/selection/grouping hooks can import the
 * shape + utilities without pulling in the heavy component (avoiding cycles).
 *
 * No JSX — render surfaces live next to their consumers.
 */

import type { ReceivingLineRow } from './receiving-line-row';

/**
 * Passed to `/api/receiving-lines` as `view`. Re-exported from the shared
 * contract so the server route and this client agree on the supported set.
 */
export type { ReceivingView } from '@/lib/receiving/receiving-views';

export interface ApiResponse {
  success: boolean;
  receiving_lines: ReceivingLineRow[];
  total: number;
  limit: number;
  offset: number;
}

export function dispatchSelectLine(row: ReceivingLineRow | null) {
  window.dispatchEvent(new CustomEvent('receiving-select-line', { detail: row }));
}

export function dispatchLineUpdated(row: Partial<ReceivingLineRow> & { id: number }) {
  window.dispatchEvent(new CustomEvent('receiving-line-updated', { detail: row }));
}

/** Selection scope shared by the table, its header Select toggle, and the
 *  SelectionActionBar (see useTableSelection / SelectionActionBar). */
export const RECEIVING_SELECTION_SCOPE = 'receiving' as const;

/**
 * Activity timestamp the History feed groups + sorts by. Default ('scanned')
 * axis = the last scan/receive (`last_activity_at` — the same axis the Recent
 * rail orders by, per its "Same as History" label), falling back to created_at.
 * Grouping on created_at alone bucketed today's scans of older Zoho-PO lines
 * into long-past weeks, so the current-week History view rendered its empty
 * state while the rail was full of the very same activity.
 *
 * The 'unboxed' axis (History's Sort → Unboxed) bands + orders by `unboxed_at`,
 * and 'received' by `received_done_at` (the terminal DONE transition) — each
 * falling back to scan/created so a row not yet at that stage still lands in a
 * real day band rather than collapsing to "Unknown". History is client-sorted
 * (serverSorted=false), so switching this axis is what actually reorders the
 * feed — the server just returns the matching 500-row window.
 */
export type ReceivingActivityAxis = 'scanned' | 'unboxed' | 'received';

export function receivingRowActivityTs(
  row: {
    last_activity_at?: string | null;
    created_at?: string | null;
    unboxed_at?: string | null;
    received_done_at?: string | null;
  },
  axis: ReceivingActivityAxis = 'scanned',
): string | null {
  if (axis === 'unboxed') {
    return row.unboxed_at ?? row.last_activity_at ?? row.created_at ?? null;
  }
  if (axis === 'received') {
    return row.received_done_at ?? row.unboxed_at ?? row.last_activity_at ?? row.created_at ?? null;
  }
  return row.last_activity_at ?? row.created_at ?? null;
}

export function receivingRowActivityMs(
  row: {
    last_activity_at?: string | null;
    created_at?: string | null;
    unboxed_at?: string | null;
    received_done_at?: string | null;
  },
  axis: ReceivingActivityAxis = 'scanned',
): number {
  const raw = receivingRowActivityTs(row, axis);
  const t = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

/**
 * A purchase-order group: every receiving line that shares a PO, collapsed into
 * a single expandable row. `anchorTs` is the timestamp the group is placed by in
 * the day-banded feed — the PO's most-recent activity (or its Zoho PO date for
 * Incoming) — so a PO whose lines were scanned across several days lands in the
 * band of its latest scan instead of fragmenting. Singleton groups (a one-line
 * PO, or an unmatched carton with no PO) render as a plain row.
 */
export interface ReceivingPoGroup {
  key: string;
  rows: ReceivingLineRow[];
  anchorTs: string | null;
}

export function poGroupAnchorMs(group: ReceivingPoGroup): number {
  const t = group.anchorTs ? new Date(group.anchorTs).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

/** Short absolute "M/D h:mm" for the history scanned/unboxed timeline. */
export function fmtShortTs(ts?: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
