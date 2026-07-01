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

/** Carton-level patch broadcast — listeners merge by `receiving_id`. */
export interface ReceivingPackageUpdatedDetail {
  receiving_id: number;
  zoho_purchaseorder_number?: string | null;
  zoho_purchaseorder_id?: string | null;
  receiving_source?: string | null;
  source_platform?: string | null;
  listing_url?: string | null;
  support_notes?: string | null;
  intake_type?: string | null;
  is_return?: boolean;
}

/** Optimistic row shape after POST /api/receiving/:id/unpair. */
export const RECEIVING_UNPAIR_ROW_PATCH: Partial<ReceivingLineRow> = {
  zoho_purchaseorder_number: null,
  zoho_purchaseorder_id: null,
  receiving_source: 'unmatched',
  source_platform: null,
  source_platform_pill: null,
  receiving_listing_url: null,
  carton_intake_type: null,
  intake_type: null,
  receiving_type: 'PO',
};

export function mergeReceivingPackageMetaIntoRow(
  row: ReceivingLineRow,
  detail: ReceivingPackageUpdatedDetail,
): ReceivingLineRow | null {
  if (row.receiving_id !== detail.receiving_id) return null;
  const next: ReceivingLineRow = { ...row };
  if ('zoho_purchaseorder_number' in detail) {
    next.zoho_purchaseorder_number = detail.zoho_purchaseorder_number ?? null;
  }
  if ('zoho_purchaseorder_id' in detail) {
    next.zoho_purchaseorder_id = detail.zoho_purchaseorder_id ?? null;
  }
  if ('receiving_source' in detail) {
    next.receiving_source = detail.receiving_source ?? null;
  }
  if ('source_platform' in detail) {
    next.source_platform = detail.source_platform ?? null;
    next.source_platform_pill = detail.source_platform ?? null;
  }
  if ('listing_url' in detail) {
    next.receiving_listing_url = detail.listing_url ?? null;
  }
  if ('intake_type' in detail) {
    next.carton_intake_type = detail.intake_type ?? null;
    next.receiving_type = detail.intake_type ?? 'PO';
  }
  if ('support_notes' in detail) {
    next.receiving_support_notes = detail.support_notes ?? null;
  }
  return next;
}

/** Broadcast a full unpair to every surface keyed on this carton. */
export function dispatchReceivingCartonUnlinkPatch(receivingId: number, lineId?: number) {
  const packageDetail: ReceivingPackageUpdatedDetail = {
    receiving_id: receivingId,
    zoho_purchaseorder_number: null,
    zoho_purchaseorder_id: null,
    receiving_source: 'unmatched',
    source_platform: null,
    listing_url: null,
    intake_type: null,
    is_return: false,
  };
  window.dispatchEvent(
    new CustomEvent('receiving-package-updated', { detail: packageDetail }),
  );
  if (lineId != null) {
    dispatchLineUpdated({
      id: lineId,
      receiving_id: receivingId,
      ...RECEIVING_UNPAIR_ROW_PATCH,
    });
  }
}

/** Selection scope shared by the table, its header Select toggle, and the
 *  SelectionActionBar (see useTableSelection / SelectionActionBar). */
export const RECEIVING_SELECTION_SCOPE = 'receiving' as const;

/**
 * Lifecycle timestamp the receiving table day-bands + within-day order by.
 * These are the same event times the Overview card and row tooltips show —
 * NOT `last_activity_at` (which folds in MAX(receiving_scans), line writes via
 * updated_at, and other later touches). A re-scan or qty edit must not bump a
 * row into today's band when the carton was actually scanned/unboxed days ago.
 *
 * Default ('scanned') axis = first tracking scan (`scanned_at`), then door-scan
 * (`received_at`), then line `created_at`. The 'unboxed' axis bands by
 * `unboxed_at`; 'received' by `received_done_at` (terminal DONE). Each falls
 * back to `created_at` so rows not yet at that stage still land in a real day
 * band. History keys day-bands on the active sort axis (unboxed or scanned);
 * Receive uses 'scanned'. History is client-sorted (serverSorted=false).
 */
export type ReceivingActivityAxis = 'scanned' | 'unboxed' | 'received';

export function receivingRowActivityTs(
  row: {
    scanned_at?: string | null;
    received_at?: string | null;
    created_at?: string | null;
    unboxed_at?: string | null;
    received_done_at?: string | null;
  },
  axis: ReceivingActivityAxis = 'scanned',
): string | null {
  if (axis === 'unboxed') {
    return row.unboxed_at ?? row.created_at ?? null;
  }
  if (axis === 'received') {
    return row.received_done_at ?? row.unboxed_at ?? row.created_at ?? null;
  }
  return row.scanned_at ?? row.received_at ?? row.created_at ?? null;
}

export function receivingRowActivityMs(
  row: {
    scanned_at?: string | null;
    received_at?: string | null;
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
