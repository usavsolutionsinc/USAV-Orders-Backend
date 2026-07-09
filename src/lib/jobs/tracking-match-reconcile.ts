/**
 * Phase D — tracking ↔ receiving match reliability.
 *
 * Historically this job also back-linked receiving rows that carried a carrier
 * tracking number in the legacy `receiving.receiving_tracking_number` text column
 * but had no `shipment_id` (D2 exact/suffix link + D3 residual register/except).
 * That column has been DROPPED: every intake path now registers its tracking into
 * `shipping_tracking_numbers` and sets `receiving.shipment_id` at scan time
 * (`record-scan` → `linkScanToStn`, the unmatched/door inserts, the manual-edit
 * routes), and a one-time backfill linked all historical rows. With no text column
 * left to reconcile, D2/D3 are retired.
 *
 * What remains is D4 — the only stage that never touched the dropped column:
 *   D4  advance still-EXPECTED PO lines whose shipment tracking's LAST 8 matches
 *       a dock scan → MATCHED + attach to the scanned carton, so a scanned box
 *       actually leaves Incoming in the data (not just hidden by the read-side
 *       SHIPMENT_SCANNED_PREDICATE). Keyed on last-8 because the Zoho-pasted
 *       number and the scanned barcode are different representations of the same
 *       package; this is the write-path twin of that predicate.
 *
 * Set-based SQL, no per-row calls, no carrier API calls.
 */
import pool from '@/lib/db';

export interface TrackingMatchReconcileResult {
  ok: boolean;
  /** rows linked to an existing STN by exact normalized match. Retired → 0. */
  linkedExact: number;
  /** rows linked to an existing STN by 18-char suffix match. Retired → 0. */
  linkedSuffix: number;
  /** carrier-detectable rows for which a new STN was registered. Retired → 0. */
  registered: number;
  /** tracking-shaped rows we couldn't place → tracking_exceptions. Retired → 0. */
  exceptions: number;
  /** still-EXPECTED PO lines advanced to MATCHED by a last-8 scan match (D4). */
  advancedLines: number;
  durationMs: number;
}

export async function runTrackingMatchReconcileJob(): Promise<TrackingMatchReconcileResult> {
  const start = Date.now();

  // ─── D4. Advance scanned PO lines by last-8 (set-based) ──────────────────
  // A still-EXPECTED incoming line should leave Incoming once its box is scanned
  // at the dock. The PO-id linker (lookup-po's linkLocalPoLinesToReceiving) only
  // fires when the scan resolves to the PO at scan time, so lines scanned via the
  // unmatched path — or synced after the scan — stay EXPECTED forever. Bridge them
  // by tracking number: resolve each incoming line to its shipment (the carton it
  // soft-joins to, FK or PO# fallback), and if any dock scan's digits contain that
  // shipment tracking's LAST 8, advance the line to MATCHED and attach it to the
  // scanned carton. Last-8 because the Zoho-pasted value and the scanned barcode
  // are different representations — the same key the read-side predicate uses, so
  // the display guard and this write agree.
  const advanced = await pool.query(
    `WITH inc AS (
       SELECT rl.id AS rl_id, rl.receiving_id, rl.zoho_purchaseorder_id
         FROM receiving_lines rl
        WHERE rl.workflow_status = 'EXPECTED'
          AND COALESCE(rl.quantity_received, 0) = 0
          AND rl.zoho_purchaseorder_id IS NOT NULL
     ),
     resolved AS (
       SELECT inc.rl_id, inc.receiving_id, stn.tracking_number_normalized AS norm
         FROM inc
         JOIN LATERAL (
           SELECT r.shipment_id FROM receiving r
            WHERE r.id = inc.receiving_id
               OR (inc.receiving_id IS NULL
                   AND r.source = 'zoho_po'
                   AND r.zoho_purchaseorder_id = inc.zoho_purchaseorder_id)
            ORDER BY (r.id = inc.receiving_id) DESC,
                     (r.shipment_id IS NOT NULL) DESC,
                     r.id DESC
            LIMIT 1
         ) r ON TRUE
         JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
        WHERE length(stn.tracking_number_normalized) >= 8
     ),
     matched AS (
       SELECT DISTINCT ON (resolved.rl_id)
              resolved.rl_id,
              rs.receiving_id AS scan_carton
         FROM resolved
         JOIN receiving_scans rs
           ON position(
                right(resolved.norm, 8)
                IN regexp_replace(upper(rs.tracking_number), '[^A-Z0-9]', '', 'g')
              ) > 0
        ORDER BY resolved.rl_id, rs.scanned_at DESC NULLS LAST
     )
     UPDATE receiving_lines rl
        SET workflow_status = 'MATCHED',
            receiving_id = COALESCE(rl.receiving_id, matched.scan_carton),
            updated_at = now()
       FROM matched
      WHERE rl.id = matched.rl_id
        AND rl.workflow_status = 'EXPECTED'`,
  );

  return {
    ok: true,
    linkedExact: 0,
    linkedSuffix: 0,
    registered: 0,
    exceptions: 0,
    advancedLines: advanced.rowCount ?? 0,
    durationMs: Date.now() - start,
  };
}
