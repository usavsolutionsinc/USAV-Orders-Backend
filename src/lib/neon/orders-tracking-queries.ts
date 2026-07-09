/**
 * orders-tracking-queries.ts
 * ─────────────────────────────────────────────────────────────────
 * Shipment-backbone tracking writes for orders. The order's tracking
 * number is NOT a column on `orders`; it lives in
 * `shipping_tracking_numbers` (normalized + carrier-detected) and is
 * reached via `orders.shipment_id` and the `order_shipment_links`
 * table. These helpers own all of that reconciliation.
 *
 * The low-level helpers (`upsertOrderTracking`, `updateShipmentTrackingById`,
 * `createAdditionalShipmentLink`, `deleteShipmentTrackingLink`) take an
 * external pg client and run NO transaction of their own — the caller
 * owns the BEGIN/COMMIT. They are shared between the legacy
 * `/api/orders/assign` route (which owns a larger transaction) and the
 * canonical `/api/orders/[id]/tracking` sub-resource.
 *
 * `applyOrderTrackingOps` is a self-managed wrapper that connects,
 * opens its own transaction, runs a batch of ops, and commits — used by
 * the sub-resource which has no surrounding transaction.
 * ─────────────────────────────────────────────────────────────────
 */
import type { PoolClient } from 'pg';
import { detectCarrier, normalizeTrackingNumber } from '@/lib/shipping/normalize';
import { transitionalUsavOrgId, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';
import { linkShipment, unlinkShipment, setPrimaryShipmentLink } from '@/lib/shipping/shipment-links';

/** Minimal pg client surface the helpers need (a pool client mid-transaction). */
type Tx = Pick<PoolClient, 'query'>;

// ─── Tenancy note ─────────────────────────────────────────────────────────────
//
// These helpers run on a caller-owned `Tx` (a raw-pool client mid-transaction),
// NOT inside withTenantTransaction — so there is no `app.current_org` GUC to
// auto-stamp `organization_id`. Both tenant-owned tables written here carry the
// column with a `usav-fallback` default (an unstamped INSERT silently misroutes
// to the USAV org rather than crashing). To make multi-tenant correct we thread
// an OPTIONAL `organizationId` and STAMP it explicitly on every INSERT:
//   - shipping_tracking_numbers (tenant-owned, has organization_id)
//   - order_shipment_links      (tenant-owned, has organization_id)
// When the caller doesn't thread one we fall back to transitionalUsavOrgId(),
// which preserves today's single-tenant (USAV) behavior exactly while letting
// multi-tenant callers pass their real `ctx.organizationId`. All current callers
// (orders/assign, orders/[id]/tracking, shipped/scan-out) have ctx.organizationId
// in scope and now pass it through.

/**
 * Is this shipment currently owned by any order — via `orders.shipment_id` or an
 * `order_shipment_links` row? Used to distinguish a genuine cross-order
 * duplicate (reject) from an orphan STN left behind by a prior delete (claim).
 */
async function isShipmentOwnedByAnyOrder(shipmentId: number, client: Tx): Promise<boolean> {
  const primary = await client.query(
    `SELECT 1 FROM orders WHERE shipment_id = $1 LIMIT 1`,
    [shipmentId],
  );
  if ((primary.rowCount ?? 0) > 0) return true;
  const linked = await client.query(
    `SELECT 1 FROM shipment_links WHERE owner_type = 'ORDER' AND shipment_id = $1 LIMIT 1`,
    [shipmentId],
  );
  return (linked.rowCount ?? 0) > 0;
}

export async function upsertOrderTracking(
  orderIds: number[],
  shippingTrackingNumber: string | null | undefined,
  client: Tx,
  organizationId?: OrgId,
): Promise<void> {
  const orgId = organizationId ?? transitionalUsavOrgId();
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

      await unlinkShipment(orgId, 'ORDER', orderId, shipmentId, client);
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

  const allLinks = await client.query(
    `SELECT DISTINCT shipment_id
     FROM shipment_links
     WHERE owner_type = 'ORDER' AND owner_id = ANY($1::int[])`,
    [orderIds]
  );
  for (const row of allLinks.rows) {
    const sid = Number(row.shipment_id);
    if (Number.isFinite(sid) && sid > 0) shipmentIdSet.add(sid);
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
           last_error_message,
           organization_id
         )
       VALUES ($1, $2, $3, 'MANUAL_PANEL_EDIT', $4, $5, $6, $7, $8, $9::uuid)
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
             -- Heal a NULL org on an orphan/legacy row; never overwrite an
             -- existing tenant's stamp.
             organization_id = COALESCE(shipping_tracking_numbers.organization_id, EXCLUDED.organization_id),
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
        orgId,
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
    // Link via the unified shipment_links table (the sole linkage SoT). The
    // helper demotes the order's other primaries first so the partial-unique
    // one-primary-per-owner index holds.
    for (const orderId of orderIds) {
      await linkShipment(
        orgId,
        { ownerType: 'ORDER', ownerId: orderId, shipmentId, direction: 'OUTBOUND', isPrimary: true, role: 'ORDER_PRIMARY', source: 'orders.assign' },
        client,
      );
    }
  }
}

export async function updateShipmentTrackingById(
  orderIds: number[],
  shipmentId: number,
  shippingTrackingNumber: string,
  client: Tx,
  // UPDATE-only (no INSERT here) — org is accepted for signature symmetry with
  // the other helpers; there is no tenant-owned row created to stamp.
  _organizationId?: OrgId,
): Promise<void> {
  void _organizationId;
  const rawTracking = String(shippingTrackingNumber || '').trim();
  if (!rawTracking) throw new Error('Tracking number is required');

  const normalizedTracking = normalizeTrackingNumber(rawTracking);
  if (!normalizedTracking) throw new Error('Tracking number is invalid');

  const ownershipCheck = await client.query(
    `SELECT 1
     FROM orders o
     LEFT JOIN shipment_links osl ON osl.owner_id = o.id AND osl.owner_type = 'ORDER'
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
  {
    const allLinks = await client.query(
      `SELECT DISTINCT shipment_id FROM shipment_links WHERE owner_type = 'ORDER' AND owner_id = ANY($1::int[])`,
      [orderIds],
    );
    for (const row of allLinks.rows) {
      const sid = Number(row.shipment_id);
      if (Number.isFinite(sid) && sid > 0 && sid !== shipmentId) ownedShipmentIds.push(sid);
    }
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

export async function createAdditionalShipmentLink(
  orderIds: number[],
  shippingTrackingNumber: string,
  client: Tx,
  organizationId?: OrgId,
): Promise<number> {
  const orgId = organizationId ?? transitionalUsavOrgId();
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
         LEFT JOIN shipment_links osl ON osl.owner_id = o.id AND osl.owner_type = 'ORDER'
         WHERE o.id = ANY($1::int[])
           AND (o.shipment_id = $2 OR osl.shipment_id = $2)
         LIMIT 1`,
        [orderIds, shipmentId],
      );
      if ((ownershipCheck.rowCount ?? 0) === 0) {
        // Not linked to THIS order. Only reject if some OTHER order owns it; an
        // orphan STN (e.g. left behind by a prior delete — we never hard-delete
        // shipping_tracking_numbers rows) is claimable and falls through to the
        // link insert below. This is what lets a just-deleted tracking number be
        // re-added without a spurious "already exists on another shipment".
        const otherOwner = await isShipmentOwnedByAnyOrder(shipmentId, client);
        if (otherOwner) {
          throw new Error('Tracking number already exists on another shipment');
        }
      } else {
        await updateShipmentTrackingById(orderIds, shipmentId, rawTracking, client, organizationId);
      }
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
           last_error_message,
           organization_id
         )
       VALUES ($1, $2, $3, 'MANUAL_PANEL_EDIT', $4, $5, $6, $7, $8, $9::uuid)
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
             -- Heal a NULL org on an orphan/legacy row; never overwrite an
             -- existing tenant's stamp.
             organization_id = COALESCE(shipping_tracking_numbers.organization_id, EXCLUDED.organization_id),
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
        orgId,
      ]
    );
    shipmentId = Number(insertedShipment.rows[0]?.id ?? 0) || null;
  }

  if (!shipmentId) throw new Error('Failed to create tracking link');

  for (const orderId of orderIds) {
    await linkShipment(
      orgId,
      { ownerType: 'ORDER', ownerId: orderId, shipmentId, direction: 'OUTBOUND', isPrimary: false, role: 'ORDER_SPLIT', source: 'orders.assign' },
      client,
    );
  }

  return shipmentId;
}

export async function deleteShipmentTrackingLink(
  orderIds: number[],
  shipmentId: number,
  client: Tx,
): Promise<void> {
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

  const deleteResult = await client.query(
    `DELETE FROM shipment_links
      WHERE owner_type = 'ORDER' AND owner_id = ANY($1::int[])
        AND shipment_id = $2`,
    [orderIds, shipmentId],
  );
  const deletedLinks = deleteResult.rowCount ?? 0;

  if ((primaryOrders.rowCount ?? 0) > 0) {
    await client.query(
      `UPDATE orders
       SET shipment_id = NULL
       WHERE id = ANY($1::int[])
         AND shipment_id = $2`,
      [orderIds, shipmentId],
    );
  }

  // Idempotent: if the shipment is already unlinked, the desired end-state is
  // achieved — no-op rather than throw. This matters inside a batch: clearing
  // the primary tracking (`upsertOrderTracking(null)`) already nulls
  // orders.shipment_id and removes its link, so a subsequent explicit delete of
  // that same shipment would otherwise throw and roll back the whole batch.
  // That was the cause of "can't delete the primary / only tracking number".
  if ((primaryOrders.rowCount ?? 0) === 0 && deletedLinks === 0) {
    return;
  }
}

// ─── Self-managed batch wrapper ──────────────────────────────────────────────

export interface ApplyOrderTrackingOps {
  orderIds: number[];
  /**
   * Desired-state: the full ordered set of tracking numbers the order should
   * have. When provided, links are reconciled to match (additions linked,
   * removals unlinked) and the legacy primary/edits/creates/deletes fields are
   * ignored. The first entry becomes the internal representative
   * (`orders.shipment_id`); `[]` clears all tracking.
   */
  setTrackingNumbers?: string[];
  /** Primary tracking (slot 0). Routed through upsertOrderTracking; '' / null clears it. */
  primaryTrackingNumber?: string | null;
  /** Edit existing linked shipments by id. */
  edits?: Array<{ shipmentId: number; trackingNumber: string }>;
  /** Create additional (non-primary) tracking links. */
  creates?: Array<{ trackingNumber: string }>;
  /** Unlink shipments from the order. */
  deletes?: Array<{ shipmentId: number }>;
  /** Which shipment should become orders.shipment_id after the batch. */
  setPrimaryShipmentId?: number | null;
  /**
   * Owning org. Threaded into every tenant-owned INSERT (shipping_tracking_numbers,
   * order_shipment_links) so they stamp organization_id explicitly. Omitted →
   * transitionalUsavOrgId() (today's single-tenant USAV behavior).
   */
  organizationId?: OrgId;
}

export interface ApplyOrderTrackingResult {
  createdShipmentIds: number[];
  primaryShipmentId: number | null;
}

/**
 * Desired-state reconcile: make the order's linked tracking set exactly match
 * `desiredRaw` (ordered). Tracking already owned is kept; new tracking is
 * linked; owned tracking no longer in the list is unlinked. The first entry
 * becomes the internal representative (`orders.shipment_id`) — there is no
 * user-facing "primary"; this pointer just satisfies single-value consumers
 * (shipped table, status dot, marketplace confirm). `[]` clears all tracking.
 *
 * Runs against a caller-owned transaction (no BEGIN/COMMIT of its own), like
 * the other low-level helpers in this file.
 */
export async function reconcileOrderTrackingSet(
  orderIds: number[],
  desiredRaw: string[],
  client: Tx,
  organizationId?: OrgId,
): Promise<{ shipmentIds: number[]; primaryShipmentId: number | null }> {
  // Normalize + dedupe the desired list, preserving order.
  const desired: Array<{ raw: string; key: string }> = [];
  const seenKeys = new Set<string>();
  for (const entry of desiredRaw) {
    const raw = String(entry || '').trim();
    if (!raw) continue;
    const key = normalizeTrackingNumber(raw);
    if (!key) throw new Error('Tracking number is invalid');
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    desired.push({ raw, key });
  }

  // Gather every shipment currently owned by the order (primary + links).
  const ownedIds = new Set<number>();
  const ownedRows = await client.query(
    `SELECT DISTINCT sid FROM (
       SELECT shipment_id AS sid FROM orders WHERE id = ANY($1::int[]) AND shipment_id IS NOT NULL
       UNION
       SELECT shipment_id AS sid FROM shipment_links WHERE owner_type = 'ORDER' AND owner_id = ANY($1::int[])
     ) x WHERE sid IS NOT NULL`,
    [orderIds],
  );
  for (const row of ownedRows.rows) {
    const sid = Number(row.sid);
    if (Number.isFinite(sid) && sid > 0) ownedIds.add(sid);
  }

  // Map normalized tracking → owned shipment id, so desired entries already on
  // the order are kept in place (not delete+recreated, preserving STN history).
  const currentByKey = new Map<string, number>();
  if (ownedIds.size > 0) {
    const keyRows = await client.query(
      `SELECT id, tracking_number_normalized FROM shipping_tracking_numbers WHERE id = ANY($1::bigint[])`,
      [Array.from(ownedIds)],
    );
    for (const row of keyRows.rows) {
      const sid = Number(row.id);
      const key = String(row.tracking_number_normalized || '');
      if (key && Number.isFinite(sid)) currentByKey.set(key, sid);
    }
  }

  // Resolve desired → shipment ids, linking any that are new.
  const shipmentIds: number[] = [];
  for (const d of desired) {
    const existing = currentByKey.get(d.key);
    if (existing) {
      shipmentIds.push(existing);
      continue;
    }
    const createdId = await createAdditionalShipmentLink(orderIds, d.raw, client, organizationId);
    shipmentIds.push(createdId);
    currentByKey.set(d.key, createdId);
  }

  // Unlink everything the order still owns that isn't in the desired set.
  const keepIds = new Set(shipmentIds);
  for (const sid of ownedIds) {
    if (!keepIds.has(sid)) {
      await deleteShipmentTrackingLink(orderIds, sid, client);
    }
  }

  // Representative pointer = first desired entry (or NULL when cleared).
  const primaryShipmentId = shipmentIds.length > 0 ? shipmentIds[0] : null;
  await client.query(
    `UPDATE orders SET shipment_id = $1 WHERE id = ANY($2::int[])`,
    [primaryShipmentId, orderIds],
  );
  if (primaryShipmentId) {
    const orgId = organizationId ?? transitionalUsavOrgId();
    for (const orderId of orderIds) {
      await setPrimaryShipmentLink(orgId, 'ORDER', orderId, primaryShipmentId, client);
    }
  }

  return { shipmentIds, primaryShipmentId };
}

/**
 * Runs a batch of tracking operations inside its own transaction. Mirrors the
 * orchestration inlined in POST /api/orders/assign so the canonical
 * `/api/orders/[id]/tracking` sub-resource reuses identical reconciliation.
 */
export async function applyOrderTrackingOps(
  ops: ApplyOrderTrackingOps,
): Promise<ApplyOrderTrackingResult> {
  const { orderIds, setTrackingNumbers, primaryTrackingNumber, edits, creates, deletes, setPrimaryShipmentId, organizationId } = ops;
  const orgId = organizationId ?? transitionalUsavOrgId();
  // Run the whole multi-statement batch on the tenant pool inside ONE
  // GUC-scoped transaction (SET LOCAL app.current_org). The low-level helpers
  // receive this same tenant client, so every write is RLS-subject and
  // organization_id auto-stamps from the GUC (explicit stamps are kept too).
  // withTenantTransaction owns BEGIN/COMMIT/ROLLBACK/release.
  return withTenantTransaction(orgId, async (client) => {
    // Desired-state path: when the caller sends the full set, reconcile to it
    // and skip the legacy primary/edits/creates/deletes ops entirely.
    if (setTrackingNumbers !== undefined) {
      const { shipmentIds, primaryShipmentId } = await reconcileOrderTrackingSet(
        orderIds,
        setTrackingNumbers,
        client,
        organizationId,
      );
      return { createdShipmentIds: shipmentIds, primaryShipmentId };
    }

    if (primaryTrackingNumber !== undefined) {
      await upsertOrderTracking(orderIds, primaryTrackingNumber, client, organizationId);
    }

    if (Array.isArray(edits) && edits.length > 0) {
      for (const edit of edits) {
        const shipmentId = Number(edit?.shipmentId);
        const nextTracking = String(edit?.trackingNumber || '').trim();
        if (!Number.isFinite(shipmentId) || shipmentId <= 0) continue;
        if (!nextTracking) continue;
        await updateShipmentTrackingById(orderIds, shipmentId, nextTracking, client, organizationId);
      }
    }

    const createdShipmentIds: number[] = [];
    if (Array.isArray(creates) && creates.length > 0) {
      for (const create of creates) {
        const nextTracking = String(create?.trackingNumber || '').trim();
        if (!nextTracking) continue;
        const createdId = await createAdditionalShipmentLink(orderIds, nextTracking, client, organizationId);
        createdShipmentIds.push(createdId);
      }
    }

    if (Array.isArray(deletes) && deletes.length > 0) {
      for (const removal of deletes) {
        const shipmentId = Number(removal?.shipmentId);
        if (!Number.isFinite(shipmentId) || shipmentId <= 0) continue;
        await deleteShipmentTrackingLink(orderIds, shipmentId, client);
      }
    }

    // Resolve which shipment should be canonical: explicit from the caller, or
    // the first newly-created one when the order had none.
    let resolvedPrimaryId: number | null = null;
    const explicitPrimary = Number(setPrimaryShipmentId);
    if (Number.isFinite(explicitPrimary) && explicitPrimary > 0) {
      resolvedPrimaryId = explicitPrimary;
    } else if (createdShipmentIds.length > 0) {
      const nullCheck = await client.query(
        `SELECT id FROM orders WHERE id = ANY($1::int[]) AND shipment_id IS NULL LIMIT 1`,
        [orderIds]
      );
      if ((nullCheck.rowCount ?? 0) > 0) {
        resolvedPrimaryId = createdShipmentIds[0];
      }
    }

    if (resolvedPrimaryId) {
      await client.query(
        `UPDATE orders SET shipment_id = $1 WHERE id = ANY($2::int[])`,
        [resolvedPrimaryId, orderIds]
      );
      for (const orderId of orderIds) {
        await linkShipment(
          orgId,
          { ownerType: 'ORDER', ownerId: orderId, shipmentId: resolvedPrimaryId, direction: 'OUTBOUND', isPrimary: true, role: 'ORDER_PRIMARY', source: 'orders.tracking' },
          client,
        );
      }
    }

    return { createdShipmentIds, primaryShipmentId: resolvedPrimaryId };
  });
}
