import pool from '@/lib/db';
import { recordOpsEvent } from '@/lib/ops-events';
import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { transitionReceivingLine } from '@/lib/receiving/state-machine';

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
 *
 * The first scan on the Unbox surface IS the operator-facing "unboxed" event
 * (scanned → unboxed → received). So this:
 *   1. Stamps the carton lifecycle: unbox_opened_at (rail filter SoT) AND
 *      unboxed_at (the "Unboxed" milestone the Overview + rail display) — both
 *      COALESCE-once, so they record the FIRST unbox scan and never move.
 *   2. Flips the carton's still-SCANNED lines (ARRIVED/MATCHED) to UNBOXED via
 *      the guarded chokepoint `transitionReceivingLine` (stamps line unboxed_at +
 *      coarse status + inventory_event atomically; already-advanced/terminal
 *      lines are skipped). Idempotent: a re-scan finds no SCANNED lines left.
 *   3. Appends the UNBOX_SCAN_OPENED ops_event (timeline / rail filter signal).
 *
 * All three steps are fail-open (a down sub-step never blocks the scan).
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
              unboxed_at      = COALESCE(unboxed_at, NOW()),
              unboxed_by      = COALESCE(unboxed_by, $3),
              updated_at = NOW()
        WHERE id = $1
          AND organization_id = $2::uuid`,
      [receivingId, organizationId, actorStaffId],
    );
  } catch (err) {
    console.warn('[recordUnboxScanOpened] receiving.unbox_opened_at stamp skipped:', err);
  }

  // Flip this carton's still-SCANNED lines to UNBOXED. One tenant tx; each line
  // goes through the guarded state-machine chokepoint (never a raw status UPDATE).
  try {
    await withTenantTransaction(organizationId as OrgId, async (client) => {
      const lines = await client.query<{ id: number }>(
        `SELECT id FROM receiving_lines
          WHERE receiving_id = $1
            AND organization_id = $2
            AND workflow_status IN ('ARRIVED', 'MATCHED')`,
        [receivingId, organizationId],
      );
      for (const { id } of lines.rows) {
        await transitionReceivingLine(
          {
            receivingLineId: id,
            to: 'UNBOXED',
            actorStaffId,
            station: 'RECEIVING',
            clientEventId:
              scanId != null
                ? `unbox-open-transition:${organizationId}:${id}:${scanId}`
                : `unbox-open-transition:${organizationId}:${id}:manual`,
            payload: { via: 'unbox_scan_opened' },
          },
          client,
          organizationId as OrgId,
        );
      }
    });
  } catch (err) {
    console.warn('[recordUnboxScanOpened] UNBOXED line transition skipped:', err);
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
