import pool from '@/lib/db';
import { registerShipmentPermissive } from '@/lib/shipping/sync-shipment';
import { recordOpsEvent } from '@/lib/ops-events';

export type ReceivingScanSource = 'zoho_po' | 'unmatched';

/** Operator surface that issued the scan — drives independent triage vs unbox stamps. */
export type ReceivingIntakeSurface = 'triage' | 'unbox';

export interface RecordReceivingScanOptions {
  /** Default `triage` — only triage (door) scans stamp received_at/received_by. */
  intakeSurface?: ReceivingIntakeSurface;
}

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

/** Idempotent scan audit row — upserts scanned_at + scanned_by per operator. */
export async function recordReceivingScan(
  receivingId: number,
  trackingNumber: string,
  carrier: string,
  staffId: number | null,
  source: ReceivingScanSource,
  options: RecordReceivingScanOptions = {},
): Promise<number> {
  const intakeSurface: ReceivingIntakeSurface = options.intakeSurface ?? 'triage';

  const result = await pool.query<{ id: number }>(
    `INSERT INTO receiving_scans
       (receiving_id, tracking_number, carrier, scanned_at, scanned_by, source, organization_id, intake_surface)
     VALUES ($1, $2, $3, NOW(), $4, $5, (SELECT organization_id FROM receiving WHERE id = $1), $6)
     ON CONFLICT (tracking_number, receiving_id) DO UPDATE
       SET scanned_at = EXCLUDED.scanned_at,
           scanned_by = EXCLUDED.scanned_by,
           carrier = COALESCE(EXCLUDED.carrier, receiving_scans.carrier),
           intake_surface = COALESCE(receiving_scans.intake_surface, EXCLUDED.intake_surface)
     RETURNING id`,
    [receivingId, trackingNumber, carrier || null, staffId, source, intakeSurface],
  );
  const scanId = Number(result.rows[0].id);

  try {
    const orgRow = await pool.query<{ organization_id: string }>(
      'SELECT organization_id FROM receiving WHERE id = $1 LIMIT 1',
      [receivingId],
    );
    const orgId = orgRow.rows[0]?.organization_id ?? null;
    if (orgId) {
      await recordOpsEvent({
        organizationId: orgId,
        entityType: 'receiving',
        entityId: receivingId,
        eventType: 'TRACKING_SCANNED',
        actorStaffId: staffId,
        clientEventId: `receiving-scan:${scanId}`,
        payload: {
          trackingNumber,
          carrier: carrier || null,
          source,
          receivingId,
          scanId,
          intakeSurface,
        },
      });
    }
  } catch (err) {
    console.warn('[recordReceivingScan] ops_events write skipped:', err);
  }

  await linkScanToStn(scanId, receivingId, trackingNumber, source);

  // Door-arrival stamp — TRIAGE surface only. Unbox scans must not touch
  // received_at/received_by so the two modes stay independent on one carton.
  if (intakeSurface === 'triage') {
    await pool.query(
      `UPDATE receiving
          SET received_at = COALESCE(received_at, NOW()),
              received_by = COALESCE(received_by, $2),
              updated_at  = NOW()
        WHERE id = $1`,
      [receivingId, staffId],
    );
  }

  return scanId;
}
