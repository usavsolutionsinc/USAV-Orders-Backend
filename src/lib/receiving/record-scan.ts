import pool from '@/lib/db';
import { registerShipmentPermissive } from '@/lib/shipping/sync-shipment';
import { extractCanonicalTracking } from '@/lib/tracking-format';

export type ReceivingScanSource = 'zoho_po' | 'unmatched';

/**
 * Register the scanned tracking into the STN master and link it to the scan +
 * carton. Returns true when STN owns the tracking (so the carton needs no legacy
 * tracking string — MAIN criterion). Runs on EVERY scan now (the old
 * RECEIVING_UNIFIED_INBOUND gate is removed): STN is the tracking source of
 * record, and the legacy `receiving.receiving_tracking_number` is written ONLY
 * as a fallback when this returns false (see recordReceivingScan). Best-effort:
 * a registration failure returns false so the fallback still records the scan.
 */
async function linkScanToStn(
  scanId: number,
  receivingId: number,
  trackingNumber: string,
  source: ReceivingScanSource,
): Promise<boolean> {
  try {
    const stn = await registerShipmentPermissive({
      trackingNumber,
      sourceSystem: `receiving_scan:${source}`,
    });
    const shipmentId = stn?.id ?? null;
    if (shipmentId == null) return false;
    await pool.query(
      `UPDATE receiving_scans SET shipment_id = $2 WHERE id = $1 AND shipment_id IS DISTINCT FROM $2`,
      [scanId, shipmentId],
    );
    await pool.query(
      `UPDATE receiving SET shipment_id = $2 WHERE id = $1 AND shipment_id IS NULL`,
      [receivingId, shipmentId],
    );
    return true;
  } catch (err) {
    console.warn(`[recordReceivingScan] linkScanToStn skipped for scan=${scanId}:`, err);
    return false;
  }
}

/** Idempotent dock-scan audit row — upserts scanned_at + scanned_by per operator. */
export async function recordReceivingScan(
  receivingId: number,
  trackingNumber: string,
  carrier: string,
  staffId: number | null,
  source: ReceivingScanSource,
): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO receiving_scans
       (receiving_id, tracking_number, carrier, scanned_at, scanned_by, source, organization_id)
     VALUES ($1, $2, $3, NOW(), $4, $5, (SELECT organization_id FROM receiving WHERE id = $1))
     ON CONFLICT (tracking_number, receiving_id) DO UPDATE
       SET scanned_at = EXCLUDED.scanned_at,
           scanned_by = EXCLUDED.scanned_by,
           carrier = COALESCE(EXCLUDED.carrier, receiving_scans.carrier)
     RETURNING id`,
    [receivingId, trackingNumber, carrier || null, staffId, source],
  );
  const scanId = Number(result.rows[0].id);
  const canonicalTracking = extractCanonicalTracking(trackingNumber) || trackingNumber;

  // Register the scan's tracking into the STN master FIRST so we know whether STN
  // owns it. STN-backed → the carton needs no legacy tracking string (MAIN
  // criterion: tracking lives only in shipping_tracking_numbers by shipment_id).
  const stnLinked = await linkScanToStn(scanId, receivingId, trackingNumber, source);

  // A recorded scan IS the physical door-arrival event, so stamp received_at on
  // the carton here — the one chokepoint every scan path funnels through
  // (lookup-po, touch-scan, the local-first re-scan, test cartons). COALESCE so
  // only the FIRST scan sets it (idempotent; re-scans never reset the arrival
  // time).
  //
  // receiving_tracking_number is now written ONLY as a FALLBACK when STN did not
  // claim the tracking (stnLinked=false — e.g. a non-carrier reference# that
  // failed registration). When STN owns it the column is left untouched: the
  // workspace tracking chip already reads STN-by-shipment_id first
  // (COALESCE(stn.tracking_number_raw, r.receiving_tracking_number)), so the chip
  // still renders. This stops legacy tracking CRUD on the receiving table for the
  // ~88% of scans STN claims, while the 287 legacy-only rows keep their value.
  await pool.query(
    `UPDATE receiving
        SET received_at = COALESCE(received_at, NOW()),
            received_by = COALESCE(received_by, $2),
            receiving_tracking_number = CASE
              WHEN $4::boolean THEN receiving_tracking_number
              ELSE COALESCE(receiving_tracking_number, $3)
            END,
            updated_at  = NOW()
      WHERE id = $1`,
    [receivingId, staffId, canonicalTracking || null, stnLinked],
  );
  return scanId;
}
