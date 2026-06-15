import pool from '@/lib/db';
import { createStationActivityLog } from '@/lib/station-activity';
import { SHIPPED_BY_CARRIER_SQL } from '@/lib/sql-fragments';

const shippedByCarrierOrLatestStatusSql = SHIPPED_BY_CARRIER_SQL;

/** Shipment ids: packed, not scanned out, not carrier-shipped — dock-staging candidates. */
export async function listDockStagingCandidateShipmentIds(
  organizationId: number | string,
): Promise<number[]> {
  const result = await pool.query<{ shipment_id: number }>(
    `SELECT DISTINCT o.shipment_id
       FROM orders o
      WHERE o.organization_id = $1
        AND o.shipment_id IS NOT NULL
        AND COALESCE(o.fulfillment_channel, '') <> 'AFN'
        AND NOT ${shippedByCarrierOrLatestStatusSql}
        AND EXISTS (
          SELECT 1 FROM station_activity_logs sal_pack
           WHERE sal_pack.shipment_id = o.shipment_id
             AND sal_pack.activity_type IN ('PACK_COMPLETED', 'PACK_SCAN')
        )
        AND NOT EXISTS (
          SELECT 1 FROM station_activity_logs sal_out
           WHERE sal_out.shipment_id = o.shipment_id
             AND sal_out.activity_type = 'SHIP_CONFIRM'
        )
        AND NOT EXISTS (
          SELECT 1 FROM station_activity_logs sal_stage
           WHERE sal_stage.shipment_id = o.shipment_id
             AND sal_stage.activity_type = 'DOCK_STAGED'
        )`,
    [organizationId],
  );
  return result.rows
    .map((row) => Number(row.shipment_id))
    .filter((id) => Number.isFinite(id) && id > 0);
}

export async function resolveStaffIdByName(
  organizationId: number | string,
  name: string,
): Promise<number | null> {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const result = await pool.query<{ id: number }>(
    `SELECT id
       FROM staff
      WHERE organization_id = $1
        AND lower(trim(name)) = lower($2)
      ORDER BY id ASC
      LIMIT 1`,
    [organizationId, trimmed],
  );
  const id = Number(result.rows[0]?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function markShipmentsDockStaged(
  organizationId: number | string,
  staffId: number,
  shipmentIds: number[],
): Promise<number> {
  if (shipmentIds.length === 0) return 0;

  let inserted = 0;
  for (const shipmentId of shipmentIds) {
    const existing = await pool.query(
      `SELECT id
         FROM station_activity_logs
        WHERE shipment_id = $1
          AND activity_type = 'DOCK_STAGED'
        LIMIT 1`,
      [shipmentId],
    );
    if (existing.rows[0]) continue;

    await createStationActivityLog(pool, {
      organizationId: String(organizationId),
      station: 'OUTBOUND',
      activityType: 'DOCK_STAGED',
      staffId,
      shipmentId,
      metadata: { source: 'outbound.mark-staged' },
    });
    inserted += 1;
  }
  return inserted;
}
