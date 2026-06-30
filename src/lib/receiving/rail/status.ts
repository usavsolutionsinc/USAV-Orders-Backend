/**
 * Receiving sidebar-rail status-dot logic — the single source of truth for the
 * left status dot + its hover label across every receiving rail (Unboxed /
 * Queue / Viewed / Triage / Prioritize / Unfound).
 *
 * Pure, DB-free, display-agnostic: every function maps a {@link ReceivingLineRow}
 * to a Tailwind dot class or a tooltip string. Colors come from the shared
 * lifecycle registry (workflow-stages.ts) so the dot, the badge, and every other
 * surface agree. Lifted out of `ReceivingRecentRail.tsx` so the sibling rails no
 * longer import status logic from a component (the coupling that forced the
 * `unfound-stub` circular-import workaround) and so the logic is unit-testable.
 *
 * Scope: the receiving page only. Testing (TestingRecentRail) and the mobile
 * scan feeds keep their own scope-appropriate dot logic.
 */

import type { ReceivingLineRow } from '@/components/station/receiving-line-row';
import {
  deriveReceivingLineStatus,
  type ReceivingLineStatus,
} from '@/lib/receiving/workflow-stages';

// Zoho statuses that mean "the vendor side considers this PO received". Mirror
// of the canonical server constant ZOHO_RECEIVED_LIKE_STATUSES in
// src/lib/receiving/zoho-received-reconcile.ts — inlined here because that module
// imports the DB pool and can't be pulled into a client bundle. Keep in sync.
const ZOHO_RECEIVED_LIKE = new Set(['received', 'billed', 'closed']);

/**
 * Operator-facing 3-state model (Scanned → Unboxed → Received), the single
 * coarse status every rail dot + label reads. Derived from the SoT
 * (`deriveReceivingLineStatus`, workflow-stages.ts) so the rail, the table chip,
 * and the Overview can never drift, with two row-level special cases the bare
 * workflow_status can't express:
 *   - Unmatched cartons have no PO/receive step → unboxed locally reads Received.
 *   - Vendor-side already-received (Zoho) reads Received in-warehouse.
 */
function railCoarseStatus(row: ReceivingLineRow): ReceivingLineStatus {
  if (row.receiving_source === 'unmatched') {
    return row.unboxed_at || (row.quantity_received ?? 0) > 0 ? 'RECEIVED' : 'SCANNED';
  }
  const zohoReceived = ZOHO_RECEIVED_LIKE.has(String(row.zoho_status ?? '').trim().toLowerCase());
  if (zohoReceived) return 'RECEIVED';
  return deriveReceivingLineStatus(row.workflow_status);
}

/** @deprecated A row at/after the RECEIVED coarse stage. Prefer {@link railCoarseStatus}. */
export function isOperatorReceived(row: ReceivingLineRow): boolean {
  return railCoarseStatus(row) === 'RECEIVED';
}

/** Coarse status → dot color. Matches `getStatusDotBg` (receiving-constants.ts). */
const COARSE_DOT: Record<ReceivingLineStatus, string> = {
  INCOMING: 'bg-amber-400',
  SCANNED: 'bg-blue-500',
  UNBOXED: 'bg-indigo-500',
  RECEIVED: 'bg-emerald-500',
};

const COARSE_LABEL: Record<ReceivingLineStatus, string> = {
  INCOMING: 'Incoming',
  SCANNED: 'Scanned',
  UNBOXED: 'Unboxed',
  RECEIVED: 'Received',
};

export function getReceivingStatusDot(row: ReceivingLineRow): string {
  return COARSE_DOT[railCoarseStatus(row)];
}

/**
 * Hover tooltip for the rail status dot. Unboxed / Queue / Viewed are view
 * filters only — the label reflects the line's physical 3-state status (Scanned
 * / Unboxed / Received), not which tab you're on.
 */
export function getReceivingStatusDotLabel(row: ReceivingLineRow): string {
  return COARSE_LABEL[railCoarseStatus(row)];
}

/**
 * Status dot for the Unboxed rail (`unboxRecent` feed). Rows here were opened on
 * the Unbox workspace, so they read at least Unboxed; once the receive button
 * finalizes the carton they read Received. Same 3-state SoT as every other rail.
 */
export function getUnboxRecentStatusDot(row: ReceivingLineRow): string {
  return COARSE_DOT[railCoarseStatus(row)];
}

/** Dot tooltip for the Unboxed rail — mirrors {@link getUnboxRecentStatusDot}. */
export function getUnboxRecentStatusDotLabel(row: ReceivingLineRow): string {
  return COARSE_LABEL[railCoarseStatus(row)];
}

/**
 * Time label for the "Received" rail's rows (formerly "Unboxed") — now a
 * recency-merged feed of unboxed ∪ new-scanned ∪ unfound cartons. MUST mirror
 * the merge sort in `buildUnboxReceivedFetcher` so relative times read
 * monotonically down the rail. Prefers the unbox stamp, then the door-scan /
 * received time, then the line's own activity, then arrival — every received
 * carton (matched or unfound) carries at least one, so a row never drops to the
 * NULLS-last bottom. Module-scope for stable identity (the rail shell wires it
 * into a listener effect).
 */
export function getReceivedActivityAt(r: ReceivingLineRow): string | null {
  return (
    r.unboxed_at ??
    r.received_at ??
    r.last_activity_at ??
    r.scanned_at ??
    r.created_at ??
    null
  );
}

/**
 * Time label for the "Viewed" rail = when YOU opened each line. The server folds
 * the viewer's own `viewed_at` into `last_activity_at` for view=viewed, so the
 * rail reads "you opened this 3m ago" rather than the unrelated scan/line time.
 */
export function getViewedAt(r: ReceivingLineRow): string | null {
  return r.last_activity_at ?? r.updated_at ?? r.created_at ?? null;
}

/**
 * Status-dot strategy registry. A rail feed selects one by id; the dot + tooltip
 * are resolved here so feeds stay declarative.
 *   - `receiving`    → shared lifecycle dot (Queue / Viewed / Triage / Unfound).
 *   - `unbox-recent` → Unboxed rail (all rows read Received; Scanned is Queue-only).
 */
export const RAIL_STATUS = {
  receiving: {
    getStatusDot: getReceivingStatusDot,
    getStatusDotLabel: getReceivingStatusDotLabel,
  },
  'unbox-recent': {
    getStatusDot: getUnboxRecentStatusDot,
    getStatusDotLabel: getUnboxRecentStatusDotLabel,
  },
} as const;

export type RailStatusId = keyof typeof RAIL_STATUS;
