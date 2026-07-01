import { NextRequest, NextResponse, after } from 'next/server';
import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { recomputeEnrichmentForOrders } from '@/lib/neon/packer-log-enrichment';
import { withTenantTransaction } from '@/lib/tenancy/db';
import { USAV_ORG_ID } from '@/lib/tenancy/constants';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { publishOrderAssignmentsUpdated, publishOrderChanged } from '@/lib/realtime/publish';
import { createAuditLog } from '@/lib/audit-logs';
import {
  getOrderAssignmentSnapshotsByOrderIds,
  getStaffNameMap,
} from '@/lib/work-assignments/order-assignment-snapshot';
import { clearReplenishmentForOrder, ensureReplenishmentForOrder } from '@/lib/replenishment';
import { withAuth } from '@/lib/auth/withAuth';
import {
  upsertOrderTracking,
  updateShipmentTrackingById,
  createAdditionalShipmentLink,
  deleteShipmentTrackingLink,
} from '@/lib/neon/orders-tracking-queries';
import { linkShipment } from '@/lib/shipping/shipment-links';

type QueryClient = {
  query: PoolClient['query'];
};

/**
 * Upsert a single work_assignment row for a given order + work_type.
 * For TEST assignments: promotes an OPEN canonical row to ASSIGNED rather than inserting a new row.
 */
async function upsertOrderAssignment(
  organizationId: string,
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
      `INSERT INTO work_assignments (organization_id, entity_type, entity_id, work_type, ${col}, status, priority)
       VALUES ($1, 'ORDER', $2, $3, $4, 'ASSIGNED', 100)
       ON CONFLICT DO NOTHING`,
      [organizationId, orderId, workType, staffId]
    );
  }
}

/**
 * Upsert the canonical ORDER/TEST work_assignment row's deadline_at.
 * Creates an OPEN row if no active TEST row exists.
 */
async function upsertOrderDeadline(
  organizationId: string,
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
         (organization_id, entity_type, entity_id, work_type, assigned_tech_id, status, priority, deadline_at)
       VALUES ($1, 'ORDER', $2, 'TEST', NULL, 'OPEN', 100, $3)
       ON CONFLICT DO NOTHING`,
      [organizationId, orderId, deadlineAt ?? null]
    );
  }
}

/**
 * POST /api/orders/assign
 * Assigns tech and/or packer to one or more orders via work_assignments.
 * Also handles non-assignment order field updates (ship_by_date, notes, etc.).
 */
export const POST = withAuth(async (req: NextRequest, ctx) => {
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
      skuCatalogId,
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

    const orgId = ctx.organizationId ?? USAV_ORG_ID;
    let outOfStockChanged = false;
    let outOfStockValue: string | null = null;

    // Sentinel for the duplicate order_id case: thrown to abort the tenant
    // transaction (the wrapper ROLLBACKs), then caught to return the exact
    // same 409 response body the inline ROLLBACK produced.
    const DUPLICATE_ORDER_ID = Symbol('duplicate_order_id');

    try {
      await withTenantTransaction(orgId, async (client) => {

      // ── 1. Write work_assignments for tech / packer ────────────────────────
      if (testerId !== undefined) {
        const techId = testerId === 0 ? null : (testerId ? Number(testerId) : null);
        await Promise.all(idsToUpdate.map((id) => upsertOrderAssignment(ctx.organizationId, id, 'TEST', techId, client)));
      }

      if (packerId !== undefined) {
        const pkId = packerId === 0 ? null : (packerId ? Number(packerId) : null);
        await Promise.all(idsToUpdate.map((id) => upsertOrderAssignment(ctx.organizationId, id, 'PACK', pkId, client)));
      }

      // ── 2a. Write deadline_at into the canonical ORDER/TEST row ───────────
      if (shipByDate !== undefined) {
        await Promise.all(
          idsToUpdate.map((id) => upsertOrderDeadline(ctx.organizationId, id, shipByDate || null, client))
        );
      }

      // ── 2b. Update carrier tracking through shipment backbone ──────────────
      // Capture which orders had NO tracking yet (shipment_id IS NULL) BEFORE the
      // upsert, so we can record a one-time `orders.tracking.added` event only on
      // the first add (re-edits stay just ORDER_ASSIGNMENT_UPDATED). Powers the
      // order timeline + the Unshipped "tracking added" record.
      let newlyTrackedIds: number[] = [];
      const trimmedTracking = String(shippingTrackingNumber ?? '').trim();
      if (shippingTrackingNumber !== undefined && trimmedTracking) {
        const priorNull = await client.query(
          `SELECT id FROM orders WHERE id = ANY($1::int[]) AND shipment_id IS NULL`,
          [idsToUpdate]
        );
        newlyTrackedIds = priorNull.rows.map((r: { id: number }) => Number(r.id));
        await upsertOrderTracking(idsToUpdate, shippingTrackingNumber, client, ctx.organizationId);
      } else if (shippingTrackingNumber !== undefined) {
        await upsertOrderTracking(idsToUpdate, shippingTrackingNumber, client, ctx.organizationId);
      }

      if (Array.isArray(trackingLinkEdits) && trackingLinkEdits.length > 0) {
        for (const edit of trackingLinkEdits) {
          const shipmentId = Number(edit?.shipmentId);
          const nextTracking = String(edit?.shippingTrackingNumber || '').trim();
          if (!Number.isFinite(shipmentId) || shipmentId <= 0) continue;
          if (!nextTracking) continue;
          await updateShipmentTrackingById(idsToUpdate, shipmentId, nextTracking, client, ctx.organizationId);
        }
      }

      const createdShipmentIds: number[] = [];
      if (Array.isArray(trackingLinkCreates) && trackingLinkCreates.length > 0) {
        for (const create of trackingLinkCreates) {
          const nextTracking = String(create?.shippingTrackingNumber || '').trim();
          if (!nextTracking) continue;
          const createdId = await createAdditionalShipmentLink(idsToUpdate, nextTracking, client, ctx.organizationId);
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
        for (const orderId of idsToUpdate) {
          await linkShipment(
            ctx.organizationId,
            { ownerType: 'ORDER', ownerId: orderId, shipmentId: resolvedPrimaryId, direction: 'OUTBOUND', isPrimary: true, role: 'ORDER_PRIMARY', source: 'orders.assign' },
            client,
          );
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
            // Abort the tenant transaction (wrapper ROLLBACKs); caught below to
            // return the same 409 body as the original inline ROLLBACK path.
            throw DUPLICATE_ORDER_ID;
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
      // Canonical SKU linkage (orders.sku_catalog_id → sku_catalog.id), resolved
      // via /api/get-title-by-sku in the add-tracking popover. Never string-joined.
      if (skuCatalogId !== undefined) {
        updates.push(`sku_catalog_id = $${paramCount++}`);
        values.push(skuCatalogId == null ? null : Number(skuCatalogId));
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
      if (skuCatalogId !== undefined) changedFields.skuCatalogId = skuCatalogId;

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

      // One-time "tracking added" event + first-time stamp for orders that had
      // no tracking before. The column is a fast read projection; audit_logs is SoT.
      if (newlyTrackedIds.length > 0) {
        await Promise.all(
          newlyTrackedIds.map((id) =>
            createAuditLog(client, {
              actorStaffId: actorId,
              source: 'api.orders.assign',
              action: 'orders.tracking.added',
              entityType: 'ORDER',
              entityId: String(id),
              requestId,
              ipAddress,
              userAgent,
              afterData: { trackingNumber: trimmedTracking },
              metadata: { orderId: id },
            }),
          ),
        );
        await client.query(
          `UPDATE orders SET tracking_added_at = NOW(), tracking_added_by = $1
             WHERE id = ANY($2::int[]) AND tracking_added_at IS NULL`,
          [actorId ?? null, newlyTrackedIds],
        );
      }

      });
    } catch (txError) {
      if (txError === DUPLICATE_ORDER_ID) {
        return NextResponse.json(
          { error: 'Order ID already exists on another order' },
          { status: 409 }
        );
      }
      throw txError;
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
          }, ctx.organizationId);
        } else {
          await clearReplenishmentForOrder(orderId, 'staff', ctx.organizationId);
        }
      }
    }

    try {
      await invalidateCacheTags(['orders', 'shipped', 'orders-next', 'tech-logs', 'packing-logs', 'need-to-order']);
    } catch (cacheErr) {
      console.warn('[orders/assign] cache invalidation failed (non-critical):', cacheErr);
    }
    // Tracking/SKU changes here can flip a packed scan's order match — refresh the
    // shipped-table read model for affected PACK scans (deferred, best-effort).
    after(() =>
      recomputeEnrichmentForOrders(pool, idsToUpdate).catch((e) =>
        console.warn('[orders/assign] enrichment recompute failed', e),
      ),
    );
    try {
      await publishOrderChanged({ organizationId: ctx.organizationId, orderIds: idsToUpdate, source: 'orders.assign' });
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
          organizationId: ctx.organizationId,
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
}, { permission: 'orders.create' });
