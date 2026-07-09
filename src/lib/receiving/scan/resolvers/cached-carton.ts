/**
 * Phase 0 resolver — find an already-MATERIALIZED carton row (`receiving_id`
 * set) among the receiving-feed rows that matches the scanned value: PO number
 * in order mode, tracking number in tracking mode, either in `auto`. Among
 * multiple lines of the same carton, prefer an OPEN line so the workspace lands
 * on something actionable. Returns `null` on no confident match (the caller
 * falls through to the next rung). EXPECTED-only incoming lines (`receiving_id`
 * null) never match here — they still need the lookup-po adopt/stamp pass.
 *
 * Pure + dependency-injected: the only input beyond the scan is `readCachedRows`
 * (a snapshot of the feed caches), so this runs DB/React-free in unit tests.
 */

import type { CachedCartonDeps, CachedCartonResolution, ScanInput } from '../types';
import { normalizeScanKey } from '../normalize';

export function resolveCachedCarton(
  input: ScanInput,
  deps: CachedCartonDeps,
): CachedCartonResolution | null {
  const key = normalizeScanKey(input.value);
  if (!key) return null;

  // `auto` (un-armed) matches EITHER identity; an armed mode matches only its
  // own field — what lets an already-in-system carton win instantly regardless
  // of whether the operator scanned its PO# or its tracking#.
  const matchOrder = input.mode === 'order' || input.mode === 'auto';
  const matchTracking = input.mode === 'tracking' || input.mode === 'auto';

  const matches = deps.readCachedRows().filter((r) => {
    if (r.receiving_id == null) return false;
    if (matchOrder && r.zoho_purchaseorder_number && normalizeScanKey(r.zoho_purchaseorder_number) === key) {
      return true;
    }
    if (matchTracking && r.tracking_number && normalizeScanKey(r.tracking_number) === key) {
      return true;
    }
    return false;
  });
  if (matches.length === 0) return null;

  // Prefer an OPEN line (received < expected, or unknown expected) so the
  // workspace lands on something actionable; else the first match.
  const open = matches.find(
    (r) => r.quantity_expected == null || r.quantity_received < (r.quantity_expected ?? 0),
  );
  const row = open ?? matches[0];
  if (row.receiving_id == null) return null;

  const poIds = row.zoho_purchaseorder_id?.trim() ? [row.zoho_purchaseorder_id.trim()] : [];
  return { kind: 'cached-carton', row, receivingId: row.receiving_id, poIds };
}
