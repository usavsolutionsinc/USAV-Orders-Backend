import pool from '@/lib/db';
import { publishOrderChanged } from '@/lib/realtime/publish';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

/**
 * After a shipment tracking status is updated (webhook or sync job),
 * look up any orders linked to this shipment and notify all clients.
 */
export async function publishShipmentStatusChange(
  shipmentId: number,
  source: string
): Promise<void> {
  try {
    const result = await pool.query(
      'SELECT id FROM orders WHERE shipment_id = $1',
      [shipmentId]
    );
    const orderIds = result.rows
      .map((r: any) => Number(r.id))
      .filter(Number.isFinite);
    if (orderIds.length === 0) return;

    await invalidateCacheTags(['orders', 'shipped', 'orders-next']);
    await publishOrderChanged({ orderIds, source });
  } catch (error) {
    console.error('[publish-on-status-change] Failed:', error);
  }
}
