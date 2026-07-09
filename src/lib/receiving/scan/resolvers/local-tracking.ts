/**
 * Local-first tracking resolver (Phase 1a) — a carton already in the system
 * (door-scanned, or otherwise carrying a receiving package) resolves straight
 * from the local receiving feed, so the hook can open it and skip lookup-po
 * entirely (no Zoho fallback, no "Opening your PO" takeover).
 *
 * Three-way outcome:
 *   • `local-matched` — local rows exist (each with a `receiving_id`); open them.
 *   • `retarget`      — no local carton, BUT the tracking maps to exactly one
 *                       known incoming PO (EXPECTED lines: PO number set,
 *                       `receiving_id` NULL). Redirect the lookup-po call to the
 *                       order-mode local-adopt path so the Zoho loader never
 *                       takes over for an already-known incoming carton. A
 *                       multi-PO tracking still needs the Zoho path (up to 3).
 *   • `null`          — order mode, or nothing local/known; fall through.
 *
 * Pure + dependency-injected (`fetchLinesByTracking`), so it runs DB/React-free.
 */

import type { LocalTrackingDeps, LocalTrackingResolution, ScanInput } from '../types';

export async function resolveLocalTracking(
  input: ScanInput,
  deps: LocalTrackingDeps,
): Promise<LocalTrackingResolution | null> {
  // Only tracking / auto scans take the local-first path; an armed Order# scan
  // goes straight to lookup-po.
  if (input.mode !== 'tracking' && input.mode !== 'auto') return null;

  const trackingRows = await deps.fetchLinesByTracking(input.value);
  const localRows = trackingRows.filter((r) => r.receiving_id != null);

  if (localRows.length > 0) {
    const receivingId = localRows[0].receiving_id as number;
    const openRows = localRows.filter(
      (r) => r.quantity_expected == null || r.quantity_received < (r.quantity_expected ?? 0),
    );
    const pick = openRows[0] ?? localRows[0];
    const poIds = [
      ...new Set(
        localRows.map((r) => (r.zoho_purchaseorder_id || '').trim()).filter((x) => x.length > 0),
      ),
    ];
    return { kind: 'local-matched', rows: localRows, pick, receivingId, poIds };
  }

  // No local carton yet — re-target only when the tracking maps to EXACTLY one
  // known incoming PO; a multi-PO tracking still needs the Zoho path.
  const incomingPoNumbers = [
    ...new Set(
      trackingRows
        .map((r) => (r.zoho_purchaseorder_number || '').trim())
        .filter((x) => x.length > 0),
    ),
  ];
  if (incomingPoNumbers.length === 1) {
    return { kind: 'retarget', mode: 'order', value: incomingPoNumbers[0] };
  }

  return null;
}
