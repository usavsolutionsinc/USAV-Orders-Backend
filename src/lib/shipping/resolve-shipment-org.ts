import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import type { OrgId } from '@/lib/tenancy/constants';

type Queryable = Pick<PoolClient, 'query'> | typeof pool;

/**
 * Resolve the owning org for a shipment. Prefers an explicit hint (caller or STN
 * row), then shipping_tracking_numbers.organization_id, then a single distinct
 * orders.organization_id. Returns null when ambiguous or missing.
 */
export async function resolveShipmentOrgId(
  shipmentId: number,
  hint?: OrgId | string | null,
  db: Queryable = pool,
): Promise<OrgId | null> {
  if (hint) return hint as OrgId;

  const stn = await db.query<{ organization_id: string | null }>(
    `SELECT organization_id FROM shipping_tracking_numbers WHERE id = $1`,
    [shipmentId],
  );
  if (stn.rows[0]?.organization_id) {
    return stn.rows[0].organization_id as OrgId;
  }

  const orders = await db.query<{ organization_id: string }>(
    `SELECT DISTINCT organization_id FROM orders
      WHERE shipment_id = $1 AND organization_id IS NOT NULL`,
    [shipmentId],
  );
  if (orders.rows.length === 1) {
    return orders.rows[0].organization_id as OrgId;
  }

  return null;
}
