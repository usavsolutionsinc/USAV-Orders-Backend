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
import { workflowStage, workflowStageDot } from '@/lib/receiving/workflow-stages';

// Zoho statuses that mean "the vendor side considers this PO received". Mirror
// of the canonical server constant ZOHO_RECEIVED_LIKE_STATUSES in
// src/lib/receiving/zoho-received-reconcile.ts — inlined here because that module
// imports the DB pool and can't be pulled into a client bundle. Keep in sync.
const ZOHO_RECEIVED_LIKE = new Set(['received', 'billed', 'closed']);

/**
 * Operator-facing 3-state model:
 *   - Incoming  → EXPECTED
 *   - Scanned   → ARRIVED | MATCHED (door scan)
 *   - Received  → everything else (UNBOXED + testing + terminal outcomes)
 *
 * This is the single predicate all rails use to decide whether a row should
 * read as "Received" in the UI.
 */
export function isOperatorReceived(row: ReceivingLineRow): boolean {
  const ws = String(row.workflow_status ?? '').trim().toUpperCase();

  // Door-scan stages are never received.
  if (ws === 'EXPECTED' || ws === 'ARRIVED' || ws === 'MATCHED' || !ws) return false;

  // Unmatched cartons become "received" once they’re unboxed locally.
  if (row.receiving_source === 'unmatched') {
    return Boolean(row.unboxed_at) || (row.quantity_received ?? 0) > 0;
  }

  // Vendor-side already-received still reads as received in-warehouse.
  const zohoReceived = ZOHO_RECEIVED_LIKE.has(String(row.zoho_status ?? '').trim().toLowerCase());
  if (zohoReceived) return true;

  // Any post-scan workflow stage counts as received for the simplified display.
  return true;
}

export function getReceivingStatusDot(row: ReceivingLineRow): string {
  return isOperatorReceived(row) ? 'bg-emerald-500' : workflowStageDot(row.workflow_status);
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
  return isOperatorReceived(row) ? 'Received' : 'Scanned';
}

/**
 * Status dot for the Unboxed rail (`unboxRecent` feed). Every row in this feed
 * was opened on the Unbox workspace — locally received/unboxed from the
 * operator's perspective — so the dot always reads Received. Door-scanned-only
 * cartons live in the Queue tab (`scanned` feed) and keep the Scanned label.
 */
export function getUnboxRecentStatusDot(_row: ReceivingLineRow): string {
  return 'bg-emerald-500';
}

/** Dot tooltip for the Unboxed rail — mirrors {@link getUnboxRecentStatusDot}. */
export function getUnboxRecentStatusDotLabel(_row: ReceivingLineRow): string {
  return 'Received';
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
