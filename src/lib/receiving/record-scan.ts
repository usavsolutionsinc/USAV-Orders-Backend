import pool from '@/lib/db';
import { registerShipmentPermissive } from '@/lib/shipping/sync-shipment';

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
    // Derive the org from the receiving row so the STN write is correctly
    // org-stamped (a scan's tracking belongs to that receiving's tenant).
    const orgRow = await pool.query<{ organization_id: string }>(
      'SELECT organization_id FROM receiving WHERE id = $1 LIMIT 1',
      [receivingId],
    );
    const orgId = orgRow.rows[0]?.organization_id;
    const stn = await registerShipmentPermissive({
      trackingNumber,
      sourceSystem: `receiving_scan:${source}`,
    }, orgId);
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

  // Register the scan's tracking into the STN master — the canonical (and now
  // sole) home for the tracking string. Linked via receiving.shipment_id; the
  // legacy receiving_tracking_number text column has been dropped.
  await linkScanToStn(scanId, receivingId, trackingNumber, source);

  // A recorded scan IS the physical door-arrival event, so stamp received_at on
  // the carton here — the one chokepoint every scan path funnels through
  // (lookup-po, touch-scan, the local-first re-scan, test cartons). COALESCE so
  // only the FIRST scan sets it (idempotent; re-scans never reset the arrival
  // time).
  await pool.query(
    `UPDATE receiving
        SET received_at = COALESCE(received_at, NOW()),
            received_by = COALESCE(received_by, $2),
            updated_at  = NOW()
      WHERE id = $1`,
    [receivingId, staffId],
  );
  return scanId;
}
