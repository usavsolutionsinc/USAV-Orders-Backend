import { NextRequest, NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishOrderAssignmentsUpdated, publishOrderChanged } from '@/lib/realtime/publish';
import { createAuditLog } from '@/lib/audit-logs';
import {
  getOrderAssignmentSnapshotsByOrderIds,
  getStaffNameMap,
} from '@/lib/work-assignments/order-assignment-snapshot';
import { clearReplenishmentForOrder, ensureReplenishmentForOrder } from '@/lib/replenishment';
import { detectCarrier, normalizeTrackingNumber } from '@/lib/shipping/normalize';

type QueryClient = {
  query: PoolClient['query'];
};

function isMissingOrderShipmentLinksRelation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /order_shipment_links/i.test(message) && /does not exist|undefined table/i.test(message);
}

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
  const existingOrders = await client.query(
    `SELECT id, shipment_id
     FROM orders
     WHERE id = ANY($1::int[])
     ORDER BY id ASC`,
    [orderIds]
  );

  const rawTracking = String(shippingTrackingNumber || '').trim();

  if (!rawTracking) {
    for (const row of existingOrders.rows) {
      const orderId = Number(row?.id);
      const shipmentId = Number(row?.shipment_id);
      if (!Number.isFinite(orderId) || orderId <= 0) continue;

      await client.query(
        `UPDATE orders
         SET shipment_id = NULL
         WHERE id = $1`,
        [orderId]
      );

      if (!Number.isFinite(shipmentId) || shipmentId <= 0) continue;

      try {
        await client.query(
          `DELETE FROM order_shipment_links
           WHERE order_row_id = $1
             AND shipment_id = $2`,
          [orderId, shipmentId]
        );
      } catch (error) {
        if (!isMissingOrderShipmentLinksRelation(error)) throw error;
      }
    }
    return;
  }

  const normalizedTracking = normalizeTrackingNumber(rawTracking);
  if (!normalizedTracking) {
    throw new Error('Tracking number is invalid');
  }

  const detectedCarrier = detectCarrier(normalizedTracking);
  const carrierForStorage = detectedCarrier ?? 'UNKNOWN';
  const isUnknownCarrier = !detectedCarrier;
  const unknownCarrierMessage =
    'Carrier detection unavailable for this tracking format; manual tracking only.';

  // Gather ALL shipment IDs linked to this order — both from orders.shipment_id
  // and order_shipment_links. This ensures the duplicate check excludes every
  // shipment already owned by the order (e.g. pasting tracking 2 into slot 1).
  const shipmentIdSet = new Set<number>(
    existingOrders.rows
      .map((row: any) => Number(row.shipment_id))
      .filter((sid: number) => Number.isFinite(sid) && sid > 0)
  );

  try {
    const allLinks = await client.query(
      `SELECT DISTINCT shipment_id
       FROM order_shipment_links
       WHERE order_row_id = ANY($1::int[])`,
      [orderIds]
    );
    for (const row of allLinks.rows) {
      const sid = Number(row.shipment_id);
      if (Number.isFinite(sid) && sid > 0) shipmentIdSet.add(sid);
    }
  } catch (error) {
    if (!isMissingOrderShipmentLinksRelation(error)) throw error;
  }

  const currentShipmentIds: number[] = Array.from(shipmentIdSet);

  // Check if this tracking number already exists in shipping_tracking_numbers.
  const existingSTN = await client.query(
    `SELECT id FROM shipping_tracking_numbers WHERE tracking_number_normalized = $1 LIMIT 1`,
    [normalizedTracking]
  );

  let shipmentId: number | null = null;

  if ((existingSTN.rowCount ?? 0) > 0) {
    const existingId = Number(existingSTN.rows[0].id);
    // Is the existing shipment owned by this order?
    if (currentShipmentIds.includes(existingId)) {
      // Already owned — just re-point orders.shipment_id to this shipment.
      // No need to update the STN row; the tracking number is identical.
      shipmentId = existingId;
    } else {
      throw new Error('Tracking number already exists on another shipment');
    }
  } else if (currentShipmentIds.length > 0) {
    // Tracking doesn't exist yet — update the first owned shipment row
    shipmentId = currentShipmentIds[0];
    await client.query(
      `UPDATE shipping_tracking_numbers
       SET tracking_number_raw = $1,
           tracking_number_normalized = $2,
           carrier = $3,
           latest_status_category = CASE
             WHEN $4::boolean THEN 'UNKNOWN'
             WHEN carrier = 'UNKNOWN' THEN NULL
             ELSE latest_status_category
           END,
           is_terminal = CASE
             WHEN $4::boolean THEN true
             WHEN carrier = 'UNKNOWN' THEN false
             ELSE is_terminal
           END,
           next_check_at = CASE
             WHEN $4::boolean THEN NULL
             WHEN carrier = 'UNKNOWN' THEN NOW()
             ELSE next_check_at
           END,
           last_error_code = CASE
             WHEN $4::boolean THEN 'UNKNOWN_CARRIER'
             WHEN carrier = 'UNKNOWN' THEN NULL
             ELSE last_error_code
           END,
           last_error_message = CASE
             WHEN $4::boolean THEN $5
             WHEN carrier = 'UNKNOWN' THEN NULL
             ELSE last_error_message
           END,
           updated_at = NOW()
       WHERE id = $6`,
      [
        rawTracking,
        normalizedTracking,
        carrierForStorage,
        isUnknownCarrier,
        unknownCarrierMessage,
        shipmentId,
      ]
    );
  } else {
    const insertedShipment = await client.query(
      `INSERT INTO shipping_tracking_numbers
         (
           tracking_number_raw,
           tracking_number_normalized,
           carrier,
           source_system,
           next_check_at,
           latest_status_category,
           is_terminal,
           last_error_code,
           last_error_message
         )
       VALUES ($1, $2, $3, 'MANUAL_PANEL_EDIT', $4, $5, $6, $7, $8)
       ON CONFLICT (tracking_number_normalized) DO UPDATE
         SET tracking_number_raw = EXCLUDED.tracking_number_raw,
             carrier = EXCLUDED.carrier,
             next_check_at = CASE
               WHEN EXCLUDED.carrier = 'UNKNOWN' THEN NULL
               WHEN shipping_tracking_numbers.carrier = 'UNKNOWN' THEN NOW()
               ELSE shipping_tracking_numbers.next_check_at
             END,
             latest_status_category = CASE
               WHEN EXCLUDED.carrier = 'UNKNOWN' THEN 'UNKNOWN'
               WHEN shipping_tracking_numbers.carrier = 'UNKNOWN' THEN NULL
               ELSE shipping_tracking_numbers.latest_status_category
             END,
             is_terminal = CASE
               WHEN EXCLUDED.carrier = 'UNKNOWN' THEN true
               WHEN shipping_tracking_numbers.carrier = 'UNKNOWN' THEN false
               ELSE shipping_tracking_numbers.is_terminal
             END,
             last_error_code = CASE
               WHEN EXCLUDED.carrier = 'UNKNOWN' THEN 'UNKNOWN_CARRIER'
               WHEN shipping_tracking_numbers.carrier = 'UNKNOWN' THEN NULL
               ELSE shipping_tracking_numbers.last_error_code
             END,
             last_error_message = CASE
               WHEN EXCLUDED.carrier = 'UNKNOWN' THEN EXCLUDED.last_error_message
               WHEN shipping_tracking_numbers.carrier = 'UNKNOWN' THEN NULL
               ELSE shipping_tracking_numbers.last_error_message
             END,
             updated_at = NOW()
       RETURNING id`,
      [
        rawTracking,
        normalizedTracking,
        carrierForStorage,
        isUnknownCarrier ? null : new Date(),
        isUnknownCarrier ? 'UNKNOWN' : null,
        isUnknownCarrier,
        isUnknownCarrier ? 'UNKNOWN_CARRIER' : null,
        isUnknownCarrier ? unknownCarrierMessage : null,
      ]
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

  // Keep link table in sync with canonical orders.shipment_id and preserve
  // additional shipment links for future multi-tracking compatibility.
  if (shipmentId) {
    try {
      await client.query(
        `UPDATE order_shipment_links
         SET is_primary = false
         WHERE order_row_id = ANY($1::int[])`,
        [orderIds]
      );
      await client.query(
        `INSERT INTO order_shipment_links (order_row_id, shipment_id, is_primary, source)
         SELECT UNNEST($1::int[]), $2::bigint, true, 'orders.assign'
         ON CONFLICT (order_row_id, shipment_id) DO UPDATE
           SET is_primary = true,
               source = EXCLUDED.source,
               updated_at = NOW()`,
        [orderIds, shipmentId]
      );
    } catch (error) {
      if (!isMissingOrderShipmentLinksRelation(error)) throw error;
    }
  }
}

async function updateShipmentTrackingById(
  orderIds: number[],
  shipmentId: number,
  shippingTrackingNumber: string,
  client: any,
) {
  const rawTracking = String(shippingTrackingNumber || '').trim();
  if (!rawTracking) throw new Error('Tracking number is required');

  const normalizedTracking = normalizeTrackingNumber(rawTracking);
  if (!normalizedTracking) throw new Error('Tracking number is invalid');

  const ownershipCheck = await client.query(
    `SELECT 1
     FROM orders o
     LEFT JOIN order_shipment_links osl ON osl.order_row_id = o.id
     WHERE o.id = ANY($1::int[])
       AND (o.shipment_id = $2 OR osl.shipment_id = $2)
     LIMIT 1`,
    [orderIds, shipmentId],
  );
  if ((ownershipCheck.rowCount ?? 0) === 0) {
    throw new Error('Shipment is not linked to this order');
  }

  // Gather all shipment IDs owned by this order so the duplicate check
  // doesn't reject tracking numbers that already belong to the same order
  // (e.g. consolidating tracking 2 into slot 1).
  const ownedShipmentIds: number[] = [shipmentId];
  try {
    const allLinks = await client.query(
      `SELECT DISTINCT shipment_id FROM order_shipment_links WHERE order_row_id = ANY($1::int[])`,
      [orderIds],
    );
    for (const row of allLinks.rows) {
      const sid = Number(row.shipment_id);
      if (Number.isFinite(sid) && sid > 0 && sid !== shipmentId) ownedShipmentIds.push(sid);
    }
  } catch (error) {
    if (!isMissingOrderShipmentLinksRelation(error)) throw error;
  }
  // Also include orders.shipment_id
  try {
    const primaryIds = await client.query(
      `SELECT DISTINCT shipment_id FROM orders WHERE id = ANY($1::int[]) AND shipment_id IS NOT NULL`,
      [orderIds],
    );
    for (const row of primaryIds.rows) {
      const sid = Number(row.shipment_id);
      if (Number.isFinite(sid) && sid > 0 && !ownedShipmentIds.includes(sid)) ownedShipmentIds.push(sid);
    }
  } catch { /* ok */ }

  const duplicateShipment = await client.query(
    `SELECT id
     FROM shipping_tracking_numbers
     WHERE tracking_number_normalized = $1
       AND id <> ALL($2::bigint[])
     LIMIT 1`,
    [normalizedTracking, ownedShipmentIds],
  );
  if ((duplicateShipment.rowCount ?? 0) > 0) {
    throw new Error('Tracking number already exists on another shipment');
  }

  const detectedCarrier = detectCarrier(normalizedTracking);
  const carrierForStorage = detectedCarrier ?? 'UNKNOWN';
  const isUnknownCarrier = !detectedCarrier;
  const unknownCarrierMessage =
    'Carrier detection unavailable for this tracking format; manual tracking only.';

  await client.query(
    `UPDATE shipping_tracking_numbers
     SET tracking_number_raw = $1,
         tracking_number_normalized = $2,
         carrier = $3,
         latest_status_category = CASE
           WHEN $4::boolean THEN 'UNKNOWN'
           WHEN carrier = 'UNKNOWN' THEN NULL
           ELSE latest_status_category
         END,
         is_terminal = CASE
           WHEN $4::boolean THEN true
           WHEN carrier = 'UNKNOWN' THEN false
           ELSE is_terminal
         END,
         next_check_at = CASE
           WHEN $4::boolean THEN NULL
           WHEN carrier = 'UNKNOWN' THEN NOW()
           ELSE next_check_at
         END,
         last_error_code = CASE
           WHEN $4::boolean THEN 'UNKNOWN_CARRIER'
           WHEN carrier = 'UNKNOWN' THEN NULL
           ELSE last_error_code
         END,
         last_error_message = CASE
           WHEN $4::boolean THEN $5
           WHEN carrier = 'UNKNOWN' THEN NULL
           ELSE last_error_message
         END,
         updated_at = NOW()
     WHERE id = $6`,
    [
      rawTracking,
      normalizedTracking,
      carrierForStorage,
      isUnknownCarrier,
      unknownCarrierMessage,
      shipmentId,
    ],
  );
}

async function createAdditionalShipmentLink(
  orderIds: number[],
  shippingTrackingNumber: string,
  client: any,
): Promise<number> {
  const rawTracking = String(shippingTrackingNumber || '').trim();
  if (!rawTracking) throw new Error('Tracking number is required');

  const normalizedTracking = normalizeTrackingNumber(rawTracking);
  if (!normalizedTracking) throw new Error('Tracking number is invalid');

  const existingShipment = await client.query(
    `SELECT id
     FROM shipping_tracking_numbers
     WHERE tracking_number_normalized = $1
     LIMIT 1`,
    [normalizedTracking],
  );

  let shipmentId: number | null = null;

  if ((existingShipment.rowCount ?? 0) > 0) {
    shipmentId = Number(existingShipment.rows[0]?.id ?? 0) || null;
    if (shipmentId) {
      const ownershipCheck = await client.query(
        `SELECT 1
         FROM orders o
         LEFT JOIN order_shipment_links osl ON osl.order_row_id = o.id
         WHERE o.id = ANY($1::int[])
           AND (o.shipment_id = $2 OR osl.shipment_id = $2)
         LIMIT 1`,
        [orderIds, shipmentId],
      );
      if ((ownershipCheck.rowCount ?? 0) === 0) {
        throw new Error('Tracking number already exists on another shipment');
      }

      await updateShipmentTrackingById(orderIds, shipmentId, rawTracking, client);
    }
  } else {
    const detectedCarrier = detectCarrier(normalizedTracking);
    const carrierForStorage = detectedCarrier ?? 'UNKNOWN';
    const isUnknownCarrier = !detectedCarrier;
    const unknownCarrierMessage =
      'Carrier detection unavailable for this tracking format; manual tracking only.';

    const insertedShipment = await client.query(
      `INSERT INTO shipping_tracking_numbers
         (
           tracking_number_raw,
           tracking_number_normalized,
           carrier,
           source_system,
           next_check_at,
           latest_status_category,
           is_terminal,
           last_error_code,
           last_error_message
         )
       VALUES ($1, $2, $3, 'MANUAL_PANEL_EDIT', $4, $5, $6, $7, $8)
       ON CONFLICT (tracking_number_normalized) DO UPDATE
         SET tracking_number_raw = EXCLUDED.tracking_number_raw,
             carrier = EXCLUDED.carrier,
             next_check_at = CASE
               WHEN EXCLUDED.carrier = 'UNKNOWN' THEN NULL
               WHEN shipping_tracking_numbers.carrier = 'UNKNOWN' THEN NOW()
               ELSE shipping_tracking_numbers.next_check_at
             END,
             latest_status_category = CASE
               WHEN EXCLUDED.carrier = 'UNKNOWN' THEN 'UNKNOWN'
               WHEN shipping_tracking_numbers.carrier = 'UNKNOWN' THEN NULL
               ELSE shipping_tracking_numbers.latest_status_category
             END,
             is_terminal = CASE
               WHEN EXCLUDED.carrier = 'UNKNOWN' THEN true
               WHEN shipping_tracking_numbers.carrier = 'UNKNOWN' THEN false
               ELSE shipping_tracking_numbers.is_terminal
             END,
             last_error_code = CASE
               WHEN EXCLUDED.carrier = 'UNKNOWN' THEN 'UNKNOWN_CARRIER'
               WHEN shipping_tracking_numbers.carrier = 'UNKNOWN' THEN NULL
               ELSE shipping_tracking_numbers.last_error_code
             END,
             last_error_message = CASE
               WHEN EXCLUDED.carrier = 'UNKNOWN' THEN EXCLUDED.last_error_message
               WHEN shipping_tracking_numbers.carrier = 'UNKNOWN' THEN NULL
               ELSE shipping_tracking_numbers.last_error_message
             END,
             updated_at = NOW()
       RETURNING id`,
      [
        rawTracking,
        normalizedTracking,
        carrierForStorage,
        isUnknownCarrier ? null : new Date(),
        isUnknownCarrier ? 'UNKNOWN' : null,
        isUnknownCarrier,
        isUnknownCarrier ? 'UNKNOWN_CARRIER' : null,
        isUnknownCarrier ? unknownCarrierMessage : null,
      ]
    );
    shipmentId = Number(insertedShipment.rows[0]?.id ?? 0) || null;
  }

  if (!shipmentId) throw new Error('Failed to create tracking link');

  try {
    await client.query(
      `INSERT INTO order_shipment_links (order_row_id, shipment_id, is_primary, source)
       SELECT UNNEST($1::int[]), $2::bigint, false, 'orders.assign'
       ON CONFLICT (order_row_id, shipment_id) DO UPDATE
         SET is_primary = false,
             source = EXCLUDED.source,
             updated_at = NOW()`,
      [orderIds, shipmentId],
    );
  } catch (error) {
    if (!isMissingOrderShipmentLinksRelation(error)) throw error;
  }

  return shipmentId;
}

async function deleteShipmentTrackingLink(
  orderIds: number[],
  shipmentId: number,
  client: any,
) {
  if (!Number.isFinite(shipmentId) || shipmentId <= 0) {
    throw new Error('Shipment id is required');
  }

  const primaryOrders = await client.query(
    `SELECT id
     FROM orders
     WHERE id = ANY($1::int[])
       AND shipment_id = $2`,
    [orderIds, shipmentId],
  );

  let deletedLinks = 0;
  try {
    const result = await client.query(
      `DELETE FROM order_shipment_links
       WHERE order_row_id = ANY($1::int[])
         AND shipment_id = $2`,
      [orderIds, shipmentId],
    );
    deletedLinks = result.rowCount ?? 0;
  } catch (error) {
    if (!isMissingOrderShipmentLinksRelation(error)) throw error;
  }

  if ((primaryOrders.rowCount ?? 0) > 0) {
    await client.query(
      `UPDATE orders
       SET shipment_id = NULL
       WHERE id = ANY($1::int[])
         AND shipment_id = $2`,
      [orderIds, shipmentId],
    );
  }

  if ((primaryOrders.rowCount ?? 0) === 0 && deletedLinks === 0) {
    throw new Error('Shipment is not linked to this order');
  }
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
      trackingLinkEdits,
      trackingLinkCreates,
      trackingLinkDeletes,
      setPrimaryShipmentId,
      itemNumber,
      condition,
      quantity,
      sku,
      performedByStaffId,
      actorStaffId,
      staffId,
    } = body;

    if (!orderId && (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0)) {
      return NextResponse.json(
        { error: 'orderId or orderIds array is required' },
        { status: 400 }
      );
    }

    const idsToUpdate: number[] = (orderId ? [orderId] : orderIds).map(Number);
    const actorIdRaw = Number(performedByStaffId ?? actorStaffId ?? staffId);
    const actorId = Number.isFinite(actorIdRaw) && actorIdRaw > 0 ? actorIdRaw : null;
    const requestId = req.headers.get('x-request-id');
    const userAgent = req.headers.get('user-agent');
    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;

    const client = await pool.connect();
    let outOfStockChanged = false;
    let outOfStockValue: string | null = null;

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

      if (Array.isArray(trackingLinkEdits) && trackingLinkEdits.length > 0) {
        for (const edit of trackingLinkEdits) {
          const shipmentId = Number(edit?.shipmentId);
          const nextTracking = String(edit?.shippingTrackingNumber || '').trim();
          if (!Number.isFinite(shipmentId) || shipmentId <= 0) continue;
          if (!nextTracking) continue;
          await updateShipmentTrackingById(idsToUpdate, shipmentId, nextTracking, client);
        }
      }

      const createdShipmentIds: number[] = [];
      if (Array.isArray(trackingLinkCreates) && trackingLinkCreates.length > 0) {
        for (const create of trackingLinkCreates) {
          const nextTracking = String(create?.shippingTrackingNumber || '').trim();
          if (!nextTracking) continue;
          const createdId = await createAdditionalShipmentLink(idsToUpdate, nextTracking, client);
          createdShipmentIds.push(createdId);
        }
      }

      if (Array.isArray(trackingLinkDeletes) && trackingLinkDeletes.length > 0) {
        for (const removal of trackingLinkDeletes) {
          const shipmentId = Number(removal?.shipmentId);
          if (!Number.isFinite(shipmentId) || shipmentId <= 0) continue;
          await deleteShipmentTrackingLink(idsToUpdate, shipmentId, client);
        }
      }

      // ── 2b′. Ensure orders.shipment_id points to a valid shipment ────────
      // Resolve which shipment id should be canonical: explicit from the
      // client, or the first newly-created one when the order had none.
      let resolvedPrimaryId: number | null = null;
      const explicitPrimary = Number(setPrimaryShipmentId);
      if (Number.isFinite(explicitPrimary) && explicitPrimary > 0) {
        resolvedPrimaryId = explicitPrimary;
      } else if (createdShipmentIds.length > 0) {
        // Frontend couldn't provide the id because it didn't exist yet.
        // Check whether orders.shipment_id is still NULL; if so, adopt the
        // first newly-created shipment.
        const nullCheck = await client.query(
          `SELECT id FROM orders WHERE id = ANY($1::int[]) AND shipment_id IS NULL LIMIT 1`,
          [idsToUpdate]
        );
        if ((nullCheck.rowCount ?? 0) > 0) {
          resolvedPrimaryId = createdShipmentIds[0];
        }
      }

      if (resolvedPrimaryId) {
        await client.query(
          `UPDATE orders SET shipment_id = $1 WHERE id = ANY($2::int[])`,
          [resolvedPrimaryId, idsToUpdate]
        );
        try {
          await client.query(
            `UPDATE order_shipment_links SET is_primary = false WHERE order_row_id = ANY($1::int[])`,
            [idsToUpdate]
          );
          await client.query(
            `INSERT INTO order_shipment_links (order_row_id, shipment_id, is_primary, source)
             SELECT UNNEST($1::int[]), $2::bigint, true, 'orders.assign'
             ON CONFLICT (order_row_id, shipment_id) DO UPDATE
               SET is_primary = true, source = 'orders.assign', updated_at = NOW()`,
            [idsToUpdate, resolvedPrimaryId]
          );
        } catch (error) {
          if (!isMissingOrderShipmentLinksRelation(error)) throw error;
        }
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
        outOfStockChanged = true;
        outOfStockValue = outOfStock;
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
      if (quantity !== undefined) {
        updates.push(`quantity = $${paramCount++}`);
        values.push(quantity || '1');
      }
      if (sku !== undefined) {
        updates.push(`sku = $${paramCount++}`);
        values.push(sku || null);
      }

      if (updates.length > 0) {
        const idPlaceholders = idsToUpdate.map(() => `$${paramCount++}`).join(', ');
        values.push(...idsToUpdate);
        await client.query(
          `UPDATE orders SET ${updates.join(', ')} WHERE id IN (${idPlaceholders})`,
          values
        );
      }

      const changedFields: Record<string, unknown> = {};
      if (testerId !== undefined) changedFields.testerId = testerId;
      if (packerId !== undefined) changedFields.packerId = packerId;
      if (orderNumber !== undefined) changedFields.orderNumber = orderNumber;
      if (shipByDate !== undefined) changedFields.shipByDate = shipByDate;
      if (outOfStock !== undefined) changedFields.outOfStock = outOfStock;
      if (notes !== undefined) changedFields.notes = notes;
      if (shippingTrackingNumber !== undefined) changedFields.shippingTrackingNumber = shippingTrackingNumber;
      if (Array.isArray(trackingLinkEdits) && trackingLinkEdits.length > 0) changedFields.trackingLinkEdits = trackingLinkEdits;
      if (Array.isArray(trackingLinkCreates) && trackingLinkCreates.length > 0) changedFields.trackingLinkCreates = trackingLinkCreates;
      if (Array.isArray(trackingLinkDeletes) && trackingLinkDeletes.length > 0) changedFields.trackingLinkDeletes = trackingLinkDeletes;
      if (itemNumber !== undefined) changedFields.itemNumber = itemNumber;
      if (condition !== undefined) changedFields.condition = condition;
      if (quantity !== undefined) changedFields.quantity = quantity;
      if (sku !== undefined) changedFields.sku = sku;

      await Promise.all(
        idsToUpdate.map((id) =>
          createAuditLog(client, {
            actorStaffId: actorId,
            source: 'api.orders.assign',
            action: 'ORDER_ASSIGNMENT_UPDATED',
            entityType: 'ORDER',
            entityId: String(id),
            requestId,
            ipAddress,
            userAgent,
            afterData: changedFields,
            metadata: {
              orderId: id,
              changedFieldKeys: Object.keys(changedFields),
            },
          }),
        ),
      );

      await client.query('COMMIT');
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

    if (process.env.FEATURE_REPLENISHMENT === 'true' && outOfStockChanged) {
      const trimmedOutOfStock = String(outOfStockValue || '').trim();
      for (const orderId of idsToUpdate) {
        if (trimmedOutOfStock) {
          await ensureReplenishmentForOrder({
            orderId,
            reason: trimmedOutOfStock,
            changedBy: 'staff',
            forceFullQuantity: true,
          });
        } else {
          await clearReplenishmentForOrder(orderId, 'staff');
        }
      }
    }

    try {
      await invalidateCacheTags(['orders', 'shipped', 'orders-next', 'tech-logs', 'packing-logs', 'need-to-order']);
    } catch (cacheErr) {
      console.warn('[orders/assign] cache invalidation failed (non-critical):', cacheErr);
    }
    try {
      await publishOrderChanged({ orderIds: idsToUpdate, source: 'orders.assign' });
    } catch (realtimeErr) {
      console.warn('[orders/assign] realtime publish failed (non-critical):', realtimeErr);
    }
    try {
      const snaps = await getOrderAssignmentSnapshotsByOrderIds(idsToUpdate);
      const staffIds = Array.from(snaps.values()).flatMap((s) => [s.testerId, s.packerId]);
      const nameMap = await getStaffNameMap(staffIds);
      for (const orderId of idsToUpdate) {
        const snap = snaps.get(orderId) ?? { testerId: null, packerId: null, deadlineAt: null };
        await publishOrderAssignmentsUpdated({
          orderId,
          testerId: snap.testerId,
          packerId: snap.packerId,
          testerName: snap.testerId != null ? nameMap.get(snap.testerId) ?? null : null,
          packerName: snap.packerId != null ? nameMap.get(snap.packerId) ?? null : null,
          deadlineAt: snap.deadlineAt,
          source: 'orders.assign',
        });
      }
    } catch (assignBroadcastErr) {
      console.warn('[orders/assign] assignment broadcast failed (non-critical):', assignBroadcastErr);
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
