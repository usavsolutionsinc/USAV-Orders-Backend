import pool from '@/lib/db';
import { recordOpsEvent } from '@/lib/ops-events';

/** Ops spine event — carton opened via a scan on the Unbox surface. */
export const UNBOX_SCAN_OPENED_EVENT = 'UNBOX_SCAN_OPENED';

/**
 * SQL predicate: carton was scanned/opened on the Unbox workspace.
 * Uses the receiving row stamp (always queryable) with ops_events as a
 * secondary signal for backfills.
 */
export const UNBOX_OPENED_PREDICATE_SQL = `(
  r.unbox_opened_at IS NOT NULL
  OR EXISTS (
    SELECT 1 FROM ops_events oe_uo
    WHERE oe_uo.organization_id = r.organization_id
      AND oe_uo.entity_type = 'receiving'
      AND oe_uo.entity_id = r.id
      AND oe_uo.event_type = '${UNBOX_SCAN_OPENED_EVENT}'
  )
)`;

/** @deprecated Use UNBOX_OPENED_PREDICATE_SQL */
export const UNBOX_SCAN_OPENED_EXISTS_SQL = UNBOX_OPENED_PREDICATE_SQL;

/**
 * Record that this carton entered the operator's Unbox work queue via a scan.
 * Dual-write: receiving.unbox_opened_at (query SoT) + ops_events (timeline).
 */
export async function recordUnboxScanOpened(
  organizationId: string,
  receivingId: number,
  actorStaffId: number | null,
  scanId: number | null,
  trackingNumber?: string,
): Promise<void> {
  try {
    await pool.query(
      `UPDATE receiving
          SET unbox_opened_at = COALESCE(unbox_opened_at, NOW()),
              unbox_opened_by = COALESCE(unbox_opened_by, $3),
              updated_at = NOW()
        WHERE id = $1
          AND organization_id = $2::uuid`,
      [receivingId, organizationId, actorStaffId],
    );
  } catch (err) {
    console.warn('[recordUnboxScanOpened] receiving.unbox_opened_at stamp skipped:', err);
  }

  const clientEventId =
    scanId != null
      ? `unbox-scan-opened:${organizationId}:${receivingId}:${scanId}`
      : `unbox-scan-opened:${organizationId}:${receivingId}:manual`;
  try {
    await recordOpsEvent({
      organizationId,
      entityType: 'receiving',
      entityId: receivingId,
      eventType: UNBOX_SCAN_OPENED_EVENT,
      actorStaffId,
      clientEventId,
      payload: trackingNumber ? { trackingNumber } : {},
    });
  } catch (err) {
    console.warn('[recordUnboxScanOpened] ops_events write skipped:', err);
  }
}
