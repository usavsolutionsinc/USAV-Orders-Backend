import pool from '@/lib/db';
import { registerShipmentPermissive } from '@/lib/shipping/sync-shipment';
import { isReceivingUnifiedInbound } from '@/lib/feature-flags';

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
  await linkScanToStn(scanId, receivingId, trackingNumber, source);
  return scanId;
}
