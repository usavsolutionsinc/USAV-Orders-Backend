import { createFbaLog } from '@/lib/fba/createFbaLog';

export type AllocationPayload = { shipmentItemId: number; quantity: number };

export function normalizeAllocations(raw: unknown): AllocationPayload[] {
  if (!Array.isArray(raw)) return [];
  const byItem = new Map<number, number>();
  for (const row of raw) {
    const source = row as { shipment_item_id?: unknown; item_id?: unknown; quantity?: unknown; qty?: unknown };
    const shipmentItemId = Number(source.shipment_item_id ?? source.item_id);
    if (!Number.isFinite(shipmentItemId) || shipmentItemId <= 0) continue;
    const parsedQty = Math.floor(Number(source.quantity ?? source.qty ?? 1));
    const quantity = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1;
    byItem.set(shipmentItemId, quantity);
  }
  return Array.from(byItem.entries()).map(([shipmentItemId, quantity]) => ({ shipmentItemId, quantity }));
}

export async function refreshShipmentAggregateCounts(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  shipmentId: number,
) {
  await client.query(
    `UPDATE fba_shipments fs
     SET ready_item_count = counts.ready,
         packed_item_count = counts.packed,
         shipped_item_count = counts.shipped,
         updated_at = NOW()
     FROM (
       SELECT shipment_id,
         COUNT(*) FILTER (WHERE status IN ('READY_TO_GO','LABEL_ASSIGNED','SHIPPED'))::int AS ready,
         COUNT(*) FILTER (WHERE status IN ('LABEL_ASSIGNED','SHIPPED'))::int AS packed,
         COUNT(*) FILTER (WHERE status = 'SHIPPED')::int AS shipped
       FROM fba_shipment_items WHERE shipment_id = $1
       GROUP BY shipment_id
     ) counts
     WHERE fs.id = counts.shipment_id`,
    [shipmentId],
  );
}

export async function replaceTrackingAllocations(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  params: {
    shipmentId: number;
    trackingId: number;
    allocations: AllocationPayload[];
    staffId: number | null;
    station: string | null;
  },
) {
  const { shipmentId, trackingId, allocations, staffId, station } = params;

  const oldRes = await client.query(
    `SELECT shipment_item_id FROM fba_tracking_item_allocations
     WHERE shipment_id = $1 AND tracking_id = $2`,
    [shipmentId, trackingId],
  );
  const oldItemIds = oldRes.rows.map((r) => Number((r as { shipment_item_id: number }).shipment_item_id));

  await client.query(
    `DELETE FROM fba_tracking_item_allocations
     WHERE shipment_id = $1
       AND tracking_id = $2`,
    [shipmentId, trackingId],
  );

  if (allocations.length > 0) {
    const shipmentItemIds = allocations.map((row) => row.shipmentItemId);
    const itemRes = await client.query(
      `SELECT id, fnsku
       FROM fba_shipment_items
       WHERE shipment_id = $1
         AND id = ANY($2::int[])`,
      [shipmentId, shipmentItemIds],
    );

    if (itemRes.rows.length !== shipmentItemIds.length) {
      throw new Error('One or more selected items are not in this shipment');
    }

    const fnskuByItemId = new Map<number, string>();
    for (const row of itemRes.rows) {
      fnskuByItemId.set(Number((row as { id: number }).id), String((row as { fnsku: string }).fnsku || '').trim().toUpperCase());
    }

    for (const allocation of allocations) {
      await client.query(
        `INSERT INTO fba_tracking_item_allocations
           (shipment_id, tracking_id, shipment_item_id, qty)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (shipment_id, tracking_id, shipment_item_id)
         DO UPDATE SET qty = EXCLUDED.qty, updated_at = NOW()`,
        [shipmentId, trackingId, allocation.shipmentItemId, allocation.quantity],
      );

      const fnsku = fnskuByItemId.get(allocation.shipmentItemId);
      if (fnsku) {
        await createFbaLog(client, {
          fnsku,
          sourceStage: 'PACK',
          eventType: 'BOXED',
          staffId,
          fbaShipmentId: shipmentId,
          fbaShipmentItemId: allocation.shipmentItemId,
          quantity: allocation.quantity,
          station: station || 'FBA_PAIRING',
          notes: 'Tracking bundle allocation',
          metadata: {
            tracking_id: trackingId,
            trigger: 'fba.shipments.tracking.allocations',
          },
        });
      }
    }
  }

  const newIds = new Set(allocations.map((a) => a.shipmentItemId));
  const removedFromBundle = oldItemIds.filter((id) => !newIds.has(id));

  if (newIds.size > 0) {
    const shipmentItemIds = [...newIds];
    await client.query(
      `UPDATE fba_shipment_items
       SET status = 'LABEL_ASSIGNED',
           labeled_by_staff_id = COALESCE(labeled_by_staff_id, $2),
           labeled_at = COALESCE(labeled_at, NOW()),
           updated_at = NOW()
       WHERE shipment_id = $1
         AND id = ANY($3::int[])
         AND status IN ('PLANNED', 'PACKING', 'READY_TO_GO')`,
      [shipmentId, staffId, shipmentItemIds],
    );
  }

  if (removedFromBundle.length > 0) {
    await client.query(
      `UPDATE fba_shipment_items fsi
       SET status = 'PLANNED',
           labeled_at = NULL,
           labeled_by_staff_id = NULL,
           updated_at = NOW()
       WHERE fsi.shipment_id = $1
         AND fsi.id = ANY($2::int[])
         AND fsi.status = 'LABEL_ASSIGNED'
         AND NOT EXISTS (
           SELECT 1 FROM fba_tracking_item_allocations ftia
           WHERE ftia.shipment_item_id = fsi.id
         )`,
      [shipmentId, removedFromBundle],
    );
  }

  await refreshShipmentAggregateCounts(client, shipmentId);

  return allocations.length;
}
