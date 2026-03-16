import { NextRequest, NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishOrderChanged } from '@/lib/realtime/publish';
import { detectCarrier, normalizeTrackingNumber } from '@/lib/shipping/normalize';

type QueryClient = {
  query: PoolClient['query'];
};

/**
 * Upsert a single work_assignment row for a given order + work_type.
 * For TEST assignments: promotes an OPEN canonical row to ASSIGNED rather than inserting a new row.
 */
async function upsertOrderAssignment(
  orderId: number,
  workType: 'TEST' | 'PACK',
  staffId: number | null,
  client: QueryClient = pool
) {
  const col = workType === 'PACK' ? 'assigned_packer_id' : 'assigned_tech_id';

  if (staffId === null) {
    // Cancel any active assignment; leave OPEN canonical rows intact (they hold deadline)
    await client.query(
      `UPDATE work_assignments
       SET status = 'CANCELED', updated_at = NOW()
       WHERE entity_type = 'ORDER'
         AND entity_id   = $1
         AND work_type   = $2
         AND status IN ('ASSIGNED', 'IN_PROGRESS')`,
      [orderId, workType]
    );
    return;
  }

  // For TEST: include OPEN rows so we promote the canonical deadline row to ASSIGNED.
  const activeStatuses = workType === 'TEST'
    ? "('OPEN', 'ASSIGNED', 'IN_PROGRESS')"
    : "('ASSIGNED', 'IN_PROGRESS')";

  const existing = await client.query(
    `SELECT id
     FROM work_assignments
     WHERE entity_type = 'ORDER'
       AND entity_id   = $1
       AND work_type   = $2
       AND status IN ${activeStatuses}
     ORDER BY
       CASE status WHEN 'ASSIGNED' THEN 1 WHEN 'IN_PROGRESS' THEN 2 WHEN 'OPEN' THEN 3 END,
       id DESC
     LIMIT 1`,
    [orderId, workType]
  );

  if (existing.rows.length > 0) {
    await client.query(
      `UPDATE work_assignments
       SET ${col} = $1, status = 'ASSIGNED', updated_at = NOW()
       WHERE id = $2`,
      [staffId, existing.rows[0].id]
    );
  } else {
    await client.query(
      `INSERT INTO work_assignments (entity_type, entity_id, work_type, ${col}, status, priority)
       VALUES ('ORDER', $1, $2, $3, 'ASSIGNED', 100)
       ON CONFLICT DO NOTHING`,
      [orderId, workType, staffId]
    );
  }
}

/**
 * Upsert the canonical ORDER/TEST work_assignment row's deadline_at.
 * Creates an OPEN row if no active TEST row exists.
 */
async function upsertOrderDeadline(
  orderId: number,
  deadlineAt: string | null,
  client: QueryClient = pool
) {
  const existing = await client.query(
    `SELECT id
     FROM work_assignments
     WHERE entity_type = 'ORDER'
       AND entity_id   = $1
       AND work_type   = 'TEST'
       AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
     ORDER BY
       CASE status WHEN 'ASSIGNED' THEN 1 WHEN 'IN_PROGRESS' THEN 2 WHEN 'OPEN' THEN 3 END,
       id DESC
     LIMIT 1`,
    [orderId]
  );

  if (existing.rows.length > 0) {
    await client.query(
      `UPDATE work_assignments
       SET deadline_at = $1, updated_at = NOW()
       WHERE id = $2`,
      [deadlineAt ?? null, existing.rows[0].id]
    );
  } else {
    await client.query(
      `INSERT INTO work_assignments
         (entity_type, entity_id, work_type, assigned_tech_id, status, priority, deadline_at)
       VALUES ('ORDER', $1, 'TEST', NULL, 'OPEN', 100, $2)
       ON CONFLICT DO NOTHING`,
      [orderId, deadlineAt ?? null]
    );
  }
}

async function upsertOrderTracking(
  orderIds: number[],
  shippingTrackingNumber: string | null | undefined,
  client: any
) {
  const rawTracking = String(shippingTrackingNumber || '').trim();

  if (!rawTracking) {
    await client.query(
      `UPDATE orders
       SET shipment_id = NULL
       WHERE id = ANY($1::int[])`,
      [orderIds]
    );
    return;
  }

  const normalizedTracking = normalizeTrackingNumber(rawTracking);
  if (!normalizedTracking) {
    throw new Error('Tracking number is invalid');
  }

  const carrier = detectCarrier(normalizedTracking);
  if (!carrier) {
    throw new Error(`Cannot detect carrier for tracking number: ${rawTracking}`);
  }

  const existingOrders = await client.query(
    `SELECT id, shipment_id
     FROM orders
     WHERE id = ANY($1::int[])
     ORDER BY id ASC`,
    [orderIds]
  );

  const currentShipmentIds: number[] = Array.from(
    new Set<number>(
      existingOrders.rows
        .map((row: any) => Number(row.shipment_id))
        .filter((shipmentId: number) => Number.isFinite(shipmentId) && shipmentId > 0)
    )
  );

  const duplicateShipment = await client.query(
    `SELECT id
     FROM shipping_tracking_numbers
     WHERE tracking_number_normalized = $1
       AND ($2::bigint[] IS NULL OR id <> ALL($2::bigint[]))
     LIMIT 1`,
    [normalizedTracking, currentShipmentIds.length > 0 ? currentShipmentIds : null]
  );

  if ((duplicateShipment.rowCount ?? 0) > 0) {
    throw new Error('Tracking number already exists on another shipment');
  }

  let shipmentId: number | null = currentShipmentIds.length > 0 ? currentShipmentIds[0] : null;

  if (shipmentId) {
    await client.query(
      `UPDATE shipping_tracking_numbers
       SET tracking_number_raw = $1,
           tracking_number_normalized = $2,
           carrier = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [rawTracking, normalizedTracking, carrier, shipmentId]
    );
  } else {
    const insertedShipment = await client.query(
      `INSERT INTO shipping_tracking_numbers
         (tracking_number_raw, tracking_number_normalized, carrier, source_system, next_check_at)
       VALUES ($1, $2, $3, 'MANUAL_PANEL_EDIT', NOW())
       ON CONFLICT (tracking_number_normalized) DO UPDATE
         SET tracking_number_raw = EXCLUDED.tracking_number_raw,
             carrier = EXCLUDED.carrier,
             updated_at = NOW()
       RETURNING id`,
      [rawTracking, normalizedTracking, carrier]
    );
    const insertedShipmentId = Number((insertedShipment.rows[0] as { id?: unknown } | undefined)?.id ?? 0);
    shipmentId = insertedShipmentId > 0 ? insertedShipmentId : null;
  }

  await client.query(
    `UPDATE orders
     SET shipment_id = $1
     WHERE id = ANY($2::int[])`,
    [shipmentId, orderIds]
  );
}

/**
 * POST /api/orders/assign
 * Assigns tech and/or packer to one or more orders via work_assignments.
 * Also handles non-assignment order field updates (ship_by_date, notes, etc.).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      orderId,
      orderIds,
      testerId,
      packerId,
      orderNumber,
      shipByDate,
      outOfStock,
      notes,
      shippingTrackingNumber,
      itemNumber,
      condition,
    } = body;

    if (!orderId && (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0)) {
      return NextResponse.json(
        { error: 'orderId or orderIds array is required' },
        { status: 400 }
      );
    }

    const idsToUpdate: number[] = (orderId ? [orderId] : orderIds).map(Number);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // ── 1. Write work_assignments for tech / packer ────────────────────────
      if (testerId !== undefined) {
        const techId = testerId === 0 ? null : (testerId ? Number(testerId) : null);
        await Promise.all(idsToUpdate.map((id) => upsertOrderAssignment(id, 'TEST', techId, client)));
      }

      if (packerId !== undefined) {
        const pkId = packerId === 0 ? null : (packerId ? Number(packerId) : null);
        await Promise.all(idsToUpdate.map((id) => upsertOrderAssignment(id, 'PACK', pkId, client)));
      }

      // ── 2a. Write deadline_at into the canonical ORDER/TEST row ───────────
      if (shipByDate !== undefined) {
        await Promise.all(
          idsToUpdate.map((id) => upsertOrderDeadline(id, shipByDate || null, client))
        );
      }

      // ── 2b. Update carrier tracking through shipment backbone ──────────────
      if (shippingTrackingNumber !== undefined) {
        await upsertOrderTracking(idsToUpdate, shippingTrackingNumber, client);
      }

      // ── 2c. Update remaining fields directly on orders table ───────────────
      const updates: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      if (orderNumber !== undefined) {
        const normalizedOrderNumber = String(orderNumber || '').trim();
        if (normalizedOrderNumber) {
          const duplicateCheck = await client.query(
            `SELECT id FROM orders WHERE order_id = $1 AND id <> ALL($2::int[]) LIMIT 1`,
            [normalizedOrderNumber, idsToUpdate]
          );
          if (duplicateCheck.rowCount && duplicateCheck.rowCount > 0) {
            await client.query('ROLLBACK');
            return NextResponse.json(
              { error: 'Order ID already exists on another order' },
              { status: 409 }
            );
          }
        }
        updates.push(`order_id = $${paramCount++}`);
        values.push(normalizedOrderNumber || null);
      }

      if (outOfStock !== undefined) {
        updates.push(`out_of_stock = $${paramCount++}`);
        values.push(outOfStock);
      }
      if (notes !== undefined) {
        updates.push(`notes = $${paramCount++}`);
        values.push(notes);
      }
      if (itemNumber !== undefined) {
        updates.push(`item_number = $${paramCount++}`);
        values.push(itemNumber || null);
      }
      if (condition !== undefined) {
        updates.push(`condition = $${paramCount++}`);
        values.push(condition || null);
      }

      if (updates.length > 0) {
        const idPlaceholders = idsToUpdate.map(() => `$${paramCount++}`).join(', ');
        values.push(...idsToUpdate);
        await client.query(
          `UPDATE orders SET ${updates.join(', ')} WHERE id IN (${idPlaceholders})`,
          values
        );
      }

      await client.query('COMMIT');
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

    try {
      await invalidateCacheTags(['orders', 'shipped', 'orders-next', 'tech-logs', 'packerlogs', 'packing-logs']);
    } catch (cacheErr) {
      console.warn('[orders/assign] cache invalidation failed (non-critical):', cacheErr);
    }
    try {
      await publishOrderChanged({ orderIds: idsToUpdate, source: 'orders.assign' });
    } catch (realtimeErr) {
      console.warn('[orders/assign] realtime publish failed (non-critical):', realtimeErr);
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error assigning order:', error);
    const message = String(error?.message || '');
    const status =
      message.includes('already exists')
        ? 409
        : message.includes('Cannot detect carrier') || message.includes('invalid')
          ? 400
          : 500;
    return NextResponse.json(
      { error: 'Failed to assign order', details: message },
      { status }
    );
  }
}
