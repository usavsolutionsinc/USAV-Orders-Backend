import pool from '@/lib/db';
import { registerShipmentPermissive } from '@/lib/shipping/sync-shipment';
import { isReceivingUnifiedInbound } from '@/lib/feature-flags';
import { extractCanonicalTracking } from '@/lib/tracking-format';

export type ReceivingScanSource = 'zoho_po' | 'unmatched';

async function linkScanToStn(
  scanId: number,
  receivingId: number,
  trackingNumber: string,
  source: ReceivingScanSource,
): Promise<void> {
  if (!isReceivingUnifiedInbound()) return;
  try {
    const stn = await registerShipmentPermissive({
      trackingNumber,
      sourceSystem: `receiving_scan:${source}`,
    });
    const shipmentId = stn?.id ?? null;
    if (shipmentId == null) return;
    await pool.query(
      `UPDATE receiving_scans SET shipment_id = $2 WHERE id = $1 AND shipment_id IS DISTINCT FROM $2`,
      [scanId, shipmentId],
    );
    await pool.query(
      `UPDATE receiving SET shipment_id = $2 WHERE id = $1 AND shipment_id IS NULL`,
      [receivingId, shipmentId],
    );
  } catch (err) {
    console.warn(`[recordReceivingScan] linkScanToStn skipped for scan=${scanId}:`, err);
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
  // A recorded scan IS the physical door-arrival event, so stamp received_at on
  // the carton here — the one chokepoint every scan path funnels through
  // (lookup-po, touch-scan, the local-first re-scan, test cartons). COALESCE so
  // only the FIRST scan sets it (idempotent; re-scans never reset the arrival
  // time). Without this, a scan of a carton whose zoho_po receiving row was
  // pre-created by the Incoming sync (received_at NULL) left received_at unset,
  // so the carton sorted last (NULLS LAST) — or vanished — in the Prioritize /
  // unbox Queue feeds, which key on received_at.
  // Persist the scanned tracking onto the carton too. The scanned barcode is the
  // tracking number (for Goodwill/marketplace POs it's the Zoho reference#), but
  // it was only ever written to receiving_scans — so the workspace tracking chip
  // (which reads receiving.receiving_tracking_number when no shipment is linked)
  // rendered the empty "----" placeholder even though the scan found the PO.
  // Canonicalize (a scanned GS1/"96" FedEx barcode → its core number) and
  // COALESCE so an existing reference#/tracking is never overwritten.
  const canonicalTracking = extractCanonicalTracking(trackingNumber) || trackingNumber;
  await pool.query(
    `UPDATE receiving
        SET received_at = COALESCE(received_at, NOW()),
            received_by = COALESCE(received_by, $2),
            receiving_tracking_number = COALESCE(receiving_tracking_number, $3),
            updated_at  = NOW()
      WHERE id = $1`,
    [receivingId, staffId, canonicalTracking || null],
  );
  await linkScanToStn(scanId, receivingId, trackingNumber, source);
  return scanId;
}
