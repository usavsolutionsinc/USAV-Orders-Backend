/**
 * Phase D — tracking ↔ receiving match reliability.
 *
 * A receiving row can carry a carrier tracking number but have no
 * `shipment_id` link (manual receiving entries, an exact-normalize mismatch
 * between the scanned barcode and the stored STN, a number the PO sync never
 * registered). Those rows then show NO carrier status at all — silently, with
 * no signal that anything is wrong.
 *
 * This job, run on the slow reconcile cron, drains that backlog deterministically:
 *   D2  exact-normalized match → link to the existing STN;
 *   D2  else 18-char suffix match (barcode vs human-readable form) → link;
 *   —   else, if the number is carrier-detectable, register a new STN + link
 *       so it enters the poll loop;
 *   D3  else (a tracking-shaped value we can't place), upsert a
 *       `tracking_exceptions` row for triage instead of leaving it invisible.
 *   D4  advance still-EXPECTED PO lines whose shipment tracking's LAST 8 matches
 *       a dock scan → MATCHED + attach to the scanned carton, so a scanned box
 *       actually leaves Incoming in the data (not just hidden by the read-side
 *       SHIPMENT_SCANNED_PREDICATE). Keyed on last-8 because the Zoho-pasted
 *       number and the scanned barcode are different representations of the same
 *       package; this is the write-path twin of that predicate.
 *
 * Bounded per run; the exact/suffix links are set-based SQL (no per-row calls),
 * only the carrier-detect/register/except residual loops in JS. No carrier API
 * calls — registration just inserts the STN; the poll cron picks it up.
 */
import pool from '@/lib/db';
import {
  normalizeTrackingNumber,
  normalizeTrackingLast8,
} from '@/lib/tracking-format';
import { detectCarrier } from '@/lib/shipping/normalize';
import { upsertShipment } from '@/lib/shipping/repository';
import { upsertOpenTrackingException } from '@/lib/tracking-exceptions';

export interface TrackingMatchReconcileResult {
  ok: boolean;
  /** rows linked to an existing STN by exact normalized match. */
  linkedExact: number;
  /** rows linked to an existing STN by 18-char suffix match (D2). */
  linkedSuffix: number;
  /** carrier-detectable rows for which a new STN was registered + linked. */
  registered: number;
  /** tracking-shaped rows we couldn't place → tracking_exceptions (D3). */
  exceptions: number;
  /** still-EXPECTED PO lines advanced to MATCHED by a last-8 scan match (D4). */
  advancedLines: number;
  durationMs: number;
}

/** Only reconcile recent receiving rows — ancient unlinked rows are dead. */
const WINDOW_DAYS = 90;
/** Cap the residual JS loop so one run can't fan out unbounded registrations. */
const RESIDUAL_CAP = 300;

const TARGET_FILTER = `
  r.shipment_id IS NULL
  AND r.receiving_tracking_number IS NOT NULL
  AND btrim(r.receiving_tracking_number) <> ''
  AND position(':' in r.receiving_tracking_number) = 0
  AND r.created_at > now() - ($1 || ' days')::interval
`;

export async function runTrackingMatchReconcileJob(): Promise<TrackingMatchReconcileResult> {
  const start = Date.now();
  const win = String(WINDOW_DAYS);

  // ─── D2a. Exact normalized link (set-based) ──────────────────────────────
  const exact = await pool.query(
    `WITH targets AS (
       SELECT r.id AS rid,
              regexp_replace(upper(r.receiving_tracking_number), '[^A-Z0-9]', '', 'g') AS norm
         FROM receiving r
        WHERE ${TARGET_FILTER}
        LIMIT 1000
     ),
     cand AS (
       SELECT t.rid, stn.id AS sid
         FROM targets t
         JOIN shipping_tracking_numbers stn
           ON stn.tracking_number_normalized = t.norm
        WHERE length(t.norm) >= 8
     )
     UPDATE receiving r
        SET shipment_id = cand.sid, updated_at = now()
       FROM cand
      WHERE r.id = cand.rid AND r.shipment_id IS NULL`,
    [win],
  );

  // ─── D2b. 18-char suffix link (set-based) ────────────────────────────────
  // Barcode (34-digit IMpb-style) vs human-readable form resolve to the same
  // 18-char tail. Pick one STN deterministically per receiving row.
  const suffix = await pool.query(
    `WITH targets AS (
       SELECT r.id AS rid,
              regexp_replace(upper(r.receiving_tracking_number), '[^A-Z0-9]', '', 'g') AS norm
         FROM receiving r
        WHERE ${TARGET_FILTER}
        LIMIT 1000
     ),
     cand AS (
       SELECT DISTINCT ON (t.rid) t.rid, stn.id AS sid
         FROM targets t
         JOIN shipping_tracking_numbers stn
           ON RIGHT(stn.tracking_number_normalized, 18) = RIGHT(t.norm, 18)
        WHERE length(t.norm) >= 12
        ORDER BY t.rid, stn.id DESC
     )
     UPDATE receiving r
        SET shipment_id = cand.sid, updated_at = now()
       FROM cand
      WHERE r.id = cand.rid AND r.shipment_id IS NULL`,
    [win],
  );

  // ─── Residual: register carrier-detectable numbers, else except (D3) ─────
  const residual = await pool.query<{ id: number; tn: string }>(
    `SELECT r.id, r.receiving_tracking_number AS tn
       FROM receiving r
      WHERE ${TARGET_FILTER}
      ORDER BY r.created_at DESC
      LIMIT ${RESIDUAL_CAP}`,
    [win],
  );

  let registered = 0;
  let exceptions = 0;

  for (const row of residual.rows) {
    const normalized = normalizeTrackingNumber(row.tn);
    if (!normalized || normalized.length < 8) continue; // not tracking-shaped — skip silently

    const carrier = detectCarrier(normalized);
    if (carrier) {
      try {
        const shipment = await upsertShipment({
          trackingNumberRaw: row.tn,
          trackingNumberNormalized: normalized,
          carrier,
          sourceSystem: 'tracking-match-reconcile',
        });
        const linked = await pool.query(
          `UPDATE receiving SET shipment_id = $1, updated_at = now()
            WHERE id = $2 AND shipment_id IS NULL`,
          [shipment.id, row.id],
        );
        if ((linked.rowCount ?? 0) > 0) registered++;
      } catch (err) {
        // Couldn't register/link a carrier-shaped number — surface for triage.
        await upsertOpenTrackingException(
          {
            trackingNumber: row.tn,
            domain: 'receiving',
            sourceStation: 'receiving',
            reason: 'no_shipment_link',
            receivingId: row.id,
            lastError: err instanceof Error ? err.message : String(err),
            domainMetadata: { source: 'tracking-match-reconcile', carrier },
          },
          pool,
        );
        exceptions++;
      }
    }
    // Non-carrier-detectable values (local-pickup refs, supplier invoice #s) are
    // intentionally left alone — they are not "missing carrier status".
  }

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
    linkedExact: exact.rowCount ?? 0,
    linkedSuffix: suffix.rowCount ?? 0,
    registered,
    exceptions,
    advancedLines: advanced.rowCount ?? 0,
    durationMs: Date.now() - start,
  };
}
