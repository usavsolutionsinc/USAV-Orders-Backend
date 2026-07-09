/**
 * Resolve an order's shipment (STN) id for outbound-document linking.
 * Mirrors the backfill's resolution order (2026-07-01d_backfill_shipping_label_links.sql):
 * the denormalized `orders.shipment_id` cache first, falling back to the
 * `shipment_links` primary row. Returns null when neither resolves (order has
 * no tracking yet) — callers link ORDER-only in that case.
 */

import type { PoolClient } from 'pg';
import { withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

type Client = Pick<PoolClient, 'query'>;

export async function resolveStnForOrder(
  orgId: OrgId,
  orderId: number,
  client?: Client,
): Promise<number | null> {
  const run = async (c: Client): Promise<number | null> => {
    const order = await c.query<{ shipment_id: number | null }>(
      `SELECT shipment_id FROM orders WHERE id = $1 AND organization_id = $2`,
      [orderId, orgId],
    );
    const cached = order.rows[0]?.shipment_id;
    if (cached != null) return Number(cached);

    const primary = await c.query<{ shipment_id: number }>(
      `SELECT shipment_id FROM shipment_links
        WHERE organization_id = $1 AND owner_type = 'ORDER' AND owner_id = $2 AND is_primary
        LIMIT 1`,
      [orgId, orderId],
    );
    return primary.rows[0] ? Number(primary.rows[0].shipment_id) : null;
  };
  if (client) return run(client);
  return withTenantTransaction<number | null>(orgId, run);
}
