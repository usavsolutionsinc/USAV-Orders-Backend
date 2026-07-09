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

/** Carton first touched on Unbox with no prior triage door scan. */
export const UNBOX_ONLY_INTAKE_PREDICATE_SQL = `(r.unbox_only_intake = true)`;

/** @deprecated Use UNBOX_OPENED_PREDICATE_SQL */
export const UNBOX_SCAN_OPENED_EXISTS_SQL = UNBOX_OPENED_PREDICATE_SQL;

/**
 * Record that this carton entered the operator's Unbox work queue via a scan.
 *
 * Unbox scans are independent from triage door stamps:
 *   1. Stamps unbox_opened_at/by only (NOT received_at, NOT unboxed_at).
 *   2. Sets unbox_only_intake when received_at is still NULL (bench-first path).
 *   3. Appends UNBOX_SCAN_OPENED ops_event for rails / timeline.
 *
 * The "Unboxed" workflow milestone (unboxed_at, line UNBOXED transition) is
 * owned by the operator's Unboxed/Receive action — not this scan.
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
              unbox_only_intake = CASE
                WHEN received_at IS NULL THEN true
                ELSE unbox_only_intake
              END,
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
