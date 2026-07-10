import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { getCurrentPSTDateKey } from '@/utils/date';
import { getPurchaseOrderById, listPurchaseReceives } from '@/lib/zoho';
import { zohoGet, zohoPost } from '@/lib/zoho/httpClient';
import { withZohoOrg } from '@/lib/zoho/tenant-context';
import { withTenantConnection, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

export type ReplenishmentStatus =
  | 'detected'
  | 'pending_review'
  | 'planned_for_po'
  | 'po_created'
  | 'waiting_for_receipt'
  | 'fulfilled'
  | 'cancelled';

export interface ReplenishmentRequestRow {
  id: string;
  item_id: string;
  zoho_item_id: string;
  sku: string | null;
  item_name: string;
  quantity_needed: string;
  zoho_quantity_available: string | null;
  zoho_quantity_on_hand: string | null;
  zoho_incoming_quantity: string | null;
  quantity_to_order: string | null;
  vendor_zoho_contact_id: string | null;
  vendor_name: string | null;
  unit_cost: string | null;
  status: ReplenishmentStatus;
  status_changed_at: string;
  zoho_po_id: string | null;
  zoho_po_number: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Minimal query surface — a raw pool, a pool client, or a test fake. */
export type DbClient = Pick<PoolClient, 'query'> | typeof pool;

const ACTIVE_STATUSES: ReplenishmentStatus[] = [
  'detected',
  'pending_review',
  'planned_for_po',
  'po_created',
  'waiting_for_receipt',
];

export const REPLENISHMENT_ALLOWED_TRANSITIONS: Record<ReplenishmentStatus, ReplenishmentStatus[]> = {
  detected: ['pending_review', 'cancelled'],
  pending_review: ['planned_for_po', 'cancelled'],
  planned_for_po: ['po_created', 'pending_review', 'cancelled'],
  po_created: ['waiting_for_receipt', 'pending_review'],
  waiting_for_receipt: ['fulfilled', 'po_created'],
  fulfilled: [],
  cancelled: [],
};

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanText(value: unknown): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : null;
}

function normalizeQuantity(value: unknown): number {
  const parsed = toNumber(value, 1);
  return parsed > 0 ? parsed : 1;
}

function itemVendorMetadata(customFields: unknown) {
  const meta = (customFields && typeof customFields === 'object') ? (customFields as Record<string, unknown>) : {};

  const vendorZohoContactId = cleanText(
    meta.default_vendor_zoho_id ??
    meta.vendor_zoho_contact_id ??
    meta.vendor_id ??
    meta.vendor_contact_id
  );

  const vendorName = cleanText(
    meta.default_vendor_name ??
    meta.vendor_name ??
    meta.vendor
  );

  return { vendorZohoContactId, vendorName };
}

async function getOrderItemContext(orderId: number, client: DbClient, orgId: OrgId) {
  // String-key JOIN (items.sku = orders.sku): align the join on organization_id
  // too and gate the order row by org.
  const result = await client.query(
    `SELECT
       o.id,
       o.order_id,
       o.product_title,
       o.sku,
       o.quantity,
       o.out_of_stock,
       i.id AS item_id,
       i.zoho_item_id,
       i.name AS item_name,
       i.purchase_rate,
       i.quantity_available AS item_quantity_available,
       i.quantity_on_hand AS item_quantity_on_hand,
       i.custom_fields
     FROM orders o
     LEFT JOIN items i ON i.sku = o.sku AND i.organization_id = o.organization_id
     WHERE o.id = $1
       AND o.organization_id = $2
     LIMIT 1`,
    [orderId, orgId]
  );

  return result.rows[0] ?? null;
}

export async function getItemStock(zohoItemId: string, orgId: OrgId): Promise<{
  zohoItemId: string;
  name: string;
  quantityAvailable: number;
  quantityOnHand: number;
}> {
  const res = await withZohoOrg(orgId, () =>
    zohoGet<{ item?: Record<string, unknown> }>(`/api/v1/items/${encodeURIComponent(zohoItemId)}`)
  );
  const item = res.item;
  if (!item) throw new Error(`Zoho item not found: ${zohoItemId}`);

  return {
    zohoItemId: String(item.item_id || zohoItemId),
    name: String(item.name || ''),
    quantityAvailable: toNumber(item.available_stock, 0),
    quantityOnHand: toNumber(item.stock_on_hand, 0),
  };
}

export async function getIncomingQuantityForItem(zohoItemId: string, orgId: OrgId): Promise<{ incomingQty: number; openPoIds: string[] }> {
  const statuses = ['open', 'confirmed'];
  let incomingQty = 0;
  const openPoIds = new Set<string>();

  for (const status of statuses) {
    const res = await withZohoOrg(orgId, () =>
      zohoGet<{ purchaseorders?: Array<{ purchaseorder_id?: string; line_items?: Array<{ item_id?: string; quantity?: number; quantity_received?: number }> }> }>(
        '/api/v1/purchaseorders',
        { status, item_id: zohoItemId, per_page: 200 }
      )
    );
    for (const po of res.purchaseorders || []) {
      const line = (po.line_items || []).find((entry) => String(entry.item_id || '') === zohoItemId);
      if (!line) continue;
      const ordered = toNumber(line.quantity, 0);
      const received = toNumber(line.quantity_received, 0);
      const pending = Math.max(0, ordered - received);
      incomingQty += pending;
      if (pending > 0 && po.purchaseorder_id) openPoIds.add(po.purchaseorder_id);
    }
  }

  return { incomingQty, openPoIds: Array.from(openPoIds) };
}

// Tenant-aware body for refreshStockCacheForItem. `exec` is the active executor
// (a GUC-scoped client or the caller's transaction client). String-key match on
// item_stock_cache.zoho_item_id / items.zoho_item_id is gated with
// AND organization_id = $n.
async function refreshStockCacheForItemBody(zohoItemId: string, exec: DbClient, orgId: OrgId) {
  const itemLookup = await exec.query(
    `SELECT id, quantity_available, quantity_on_hand FROM items WHERE zoho_item_id = $1 AND organization_id = $2 LIMIT 1`,
    [zohoItemId, orgId]
  );
  const localItem = itemLookup.rows[0] ?? null;

  try {
    const [stock, incoming] = await Promise.all([
      getItemStock(zohoItemId, orgId),
      getIncomingQuantityForItem(zohoItemId, orgId),
    ]);

    const upsert = await exec.query(
      `INSERT INTO item_stock_cache (
         organization_id, zoho_item_id, item_id, quantity_available, quantity_on_hand, incoming_quantity, open_po_ids, sync_error, last_synced_at
       ) VALUES ($7, $1, $2, $3, $4, $5, $6, NULL, NOW())
       ON CONFLICT (zoho_item_id) DO UPDATE SET
         item_id = EXCLUDED.item_id,
         quantity_available = EXCLUDED.quantity_available,
         quantity_on_hand = EXCLUDED.quantity_on_hand,
         incoming_quantity = EXCLUDED.incoming_quantity,
         open_po_ids = EXCLUDED.open_po_ids,
         sync_error = NULL,
         last_synced_at = NOW()
       WHERE item_stock_cache.organization_id = $7
       RETURNING *`,
      [zohoItemId, localItem?.id ?? null, stock.quantityAvailable, stock.quantityOnHand, incoming.incomingQty, incoming.openPoIds, orgId]
    );

    await exec.query(
      `UPDATE replenishment_requests
       SET zoho_quantity_available = $2,
           zoho_quantity_on_hand = $3,
           zoho_incoming_quantity = $4,
           updated_at = NOW()
       WHERE zoho_item_id = $1
         AND organization_id = $5
         AND status <> 'fulfilled'
         AND status <> 'cancelled'`,
      [zohoItemId, stock.quantityAvailable, stock.quantityOnHand, incoming.incomingQty, orgId]
    );

    return upsert.rows[0];
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Zoho sync error';
    const fallbackAvailable = toNumber(localItem?.quantity_available, 0);
    const fallbackOnHand = toNumber(localItem?.quantity_on_hand, 0);

    const upsert = await exec.query(
      `INSERT INTO item_stock_cache (
         organization_id, zoho_item_id, item_id, quantity_available, quantity_on_hand, incoming_quantity, open_po_ids, sync_error, last_synced_at
       ) VALUES ($6, $1, $2, $3, $4, 0, NULL, $5, NULL)
       ON CONFLICT (zoho_item_id) DO UPDATE SET
         item_id = EXCLUDED.item_id,
         quantity_available = EXCLUDED.quantity_available,
         quantity_on_hand = EXCLUDED.quantity_on_hand,
         sync_error = EXCLUDED.sync_error
       WHERE item_stock_cache.organization_id = $6
       RETURNING *`,
      [zohoItemId, localItem?.id ?? null, fallbackAvailable, fallbackOnHand, message, orgId]
    );

    return upsert.rows[0];
  }
}

export async function refreshStockCacheForItem(zohoItemId: string, client: DbClient, orgId: OrgId) {
  // Caller already supplied a (GUC-scoped / transaction) client → use it in place.
  if (client !== pool) return refreshStockCacheForItemBody(zohoItemId, client, orgId);
  // Default pool sentinel → run inside a fresh GUC-scoped transaction.
  return withTenantTransaction(orgId, (c) => refreshStockCacheForItemBody(zohoItemId, c, orgId));
}

async function getOrRefreshStockCacheBody(zohoItemId: string, exec: DbClient, orgId: OrgId) {
  const result = await exec.query(
    `SELECT * FROM item_stock_cache WHERE zoho_item_id = $1 AND organization_id = $2 LIMIT 1`,
    [zohoItemId, orgId]
  );
  const existing = result.rows[0] ?? null;

  const stale = !existing?.last_synced_at || (Date.now() - new Date(existing.last_synced_at).getTime()) > 10 * 60 * 1000;
  if (!stale) return existing;

  return refreshStockCacheForItem(zohoItemId, exec, orgId);
}

export async function getOrRefreshStockCache(zohoItemId: string, client: DbClient, orgId: OrgId) {
  if (client !== pool) return getOrRefreshStockCacheBody(zohoItemId, client, orgId);
  return withTenantConnection(orgId, (c) => getOrRefreshStockCacheBody(zohoItemId, c, orgId));
}

async function findActiveRequestForItemBody(zohoItemId: string, exec: DbClient, orgId: OrgId): Promise<ReplenishmentRequestRow | null> {
  const result = await exec.query(
    `SELECT *
     FROM replenishment_requests
     WHERE zoho_item_id = $1
       AND organization_id = $3
       AND status = ANY($2::replenishment_status[])
     ORDER BY created_at DESC
     LIMIT 1`,
    [zohoItemId, ACTIVE_STATUSES, orgId]
  );
  return (result.rows[0] as ReplenishmentRequestRow | undefined) ?? null;
}

export async function findActiveRequestForItem(zohoItemId: string, client: DbClient, orgId: OrgId): Promise<ReplenishmentRequestRow | null> {
  if (client !== pool) return findActiveRequestForItemBody(zohoItemId, client, orgId);
  return withTenantConnection(orgId, (c) => findActiveRequestForItemBody(zohoItemId, c, orgId));
}

async function recomputeRequestQuantityBody(requestId: string, exec: DbClient, orgId: OrgId) {
  await exec.query(
    `UPDATE replenishment_requests rr
     SET quantity_needed = COALESCE((
           SELECT SUM(rol.quantity_needed)
           FROM replenishment_order_lines rol
           WHERE rol.replenishment_request_id = rr.id
             AND rol.organization_id = rr.organization_id
         ), 0),
         updated_at = NOW()
     WHERE rr.id = $1
       AND rr.organization_id = $2`,
    [requestId, orgId]
  );
}

async function recomputeRequestQuantity(requestId: string, client: DbClient, orgId: OrgId) {
  if (client !== pool) return recomputeRequestQuantityBody(requestId, client, orgId);
  return withTenantTransaction(orgId, (c) => recomputeRequestQuantityBody(requestId, c, orgId));
}

async function transitionReplenishmentStatusBody(
  requestId: string,
  nextStatus: ReplenishmentStatus,
  changedBy: string,
  note: string | null | undefined,
  exec: DbClient,
  orgId: OrgId
) {
  const result = await exec.query(
    `SELECT id, status FROM replenishment_requests WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [requestId, orgId]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Replenishment request not found');

  const current = row.status as ReplenishmentStatus;
  if (current === nextStatus) return;
  if (!REPLENISHMENT_ALLOWED_TRANSITIONS[current].includes(nextStatus)) {
    throw new Error(`Invalid replenishment transition: ${current} -> ${nextStatus}`);
  }

  await exec.query(
    `UPDATE replenishment_requests
     SET status = $2, status_changed_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND organization_id = $3`,
    [requestId, nextStatus, orgId]
  );

  // Child insert: derive org from the parent request (also a backstop if the
  // threaded orgId ever diverges from the row's true owner).
  await exec.query(
    `INSERT INTO replenishment_status_log (organization_id, replenishment_request_id, from_status, to_status, changed_by, note)
     SELECT rr.organization_id, $1, $2, $3, $4, $5
     FROM replenishment_requests rr
     WHERE rr.id = $1 AND rr.organization_id = $6`,
    [requestId, current, nextStatus, changedBy, cleanText(note), orgId]
  );
}

export async function transitionReplenishmentStatus(
  requestId: string,
  nextStatus: ReplenishmentStatus,
  changedBy: string,
  note: string | null | undefined,
  client: DbClient,
  orgId: OrgId
) {
  if (client !== pool) return transitionReplenishmentStatusBody(requestId, nextStatus, changedBy, note, client, orgId);
  return withTenantTransaction(orgId, (c) => transitionReplenishmentStatusBody(requestId, nextStatus, changedBy, note, c, orgId));
}

async function recalculateNeedBody(requestId: string, exec: DbClient, orgId: OrgId) {
  const result = await exec.query(
    `SELECT * FROM replenishment_requests WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [requestId, orgId]
  );
  const request = result.rows[0] as ReplenishmentRequestRow | undefined;
  if (!request) return;

  const stock = await getOrRefreshStockCache(request.zoho_item_id, exec, orgId);
  const effectiveShortfall = Math.max(
    0,
    toNumber(request.quantity_needed, 0) -
      toNumber(stock?.quantity_available, 0) -
      toNumber(stock?.incoming_quantity, 0)
  );

  await exec.query(
    `UPDATE replenishment_requests
     SET zoho_quantity_available = $2,
         zoho_quantity_on_hand = $3,
         zoho_incoming_quantity = $4,
         updated_at = NOW()
     WHERE id = $1 AND organization_id = $5`,
    [requestId, toNumber(stock?.quantity_available, 0), toNumber(stock?.quantity_on_hand, 0), toNumber(stock?.incoming_quantity, 0), orgId]
  );

  if (effectiveShortfall === 0 && ['detected', 'pending_review'].includes(request.status)) {
    await transitionReplenishmentStatus(requestId, 'cancelled', 'system', 'Incoming stock already covers demand', exec, orgId);
  }
}

export async function recalculateNeed(requestId: string, client: DbClient, orgId: OrgId) {
  if (client !== pool) return recalculateNeedBody(requestId, client, orgId);
  return withTenantTransaction(orgId, (c) => recalculateNeedBody(requestId, c, orgId));
}

async function ensureReplenishmentForOrderBody(
  client: PoolClient,
  options: { orderId: number; reason?: string | null; changedBy?: string; forceFullQuantity?: boolean },
  orgId: OrgId
): Promise<{ requestId: string | null; skipped: 'order_not_found' | 'item_not_linked' | null }> {
  const { orderId, reason, changedBy = 'system', forceFullQuantity = false } = options;

  const order = await getOrderItemContext(orderId, client, orgId);
  if (!order) {
    return { requestId: null, skipped: 'order_not_found' as const };
  }

  if (!order.item_id || !order.zoho_item_id) {
    return { requestId: null, skipped: 'item_not_linked' as const };
  }

  const stock = await getOrRefreshStockCache(order.zoho_item_id, client, orgId);
  const orderQty = normalizeQuantity(order.quantity);
  const shortfall = forceFullQuantity ? orderQty : Math.max(0, orderQty - toNumber(stock?.quantity_available, 0));
  const quantityNeeded = shortfall > 0 ? shortfall : orderQty;

  const existing = await findActiveRequestForItem(order.zoho_item_id, client, orgId);
  let requestId = existing?.id ?? null;

  if (!existing) {
    const vendor = itemVendorMetadata(order.custom_fields);
    const insert = await client.query(
      `INSERT INTO replenishment_requests (
         organization_id,
         item_id,
         zoho_item_id,
         sku,
         item_name,
         quantity_needed,
         zoho_quantity_available,
         zoho_quantity_on_hand,
         zoho_incoming_quantity,
         vendor_zoho_contact_id,
         vendor_name,
         unit_cost,
         status,
         notes
       ) VALUES ($13, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'detected', $12)
       RETURNING id`,
      [
        order.item_id,
        order.zoho_item_id,
        cleanText(order.sku),
        cleanText(order.item_name) || cleanText(order.product_title) || 'Unknown item',
        quantityNeeded,
        toNumber(stock?.quantity_available, 0),
        toNumber(stock?.quantity_on_hand, 0),
        toNumber(stock?.incoming_quantity, 0),
        vendor.vendorZohoContactId,
        vendor.vendorName,
        cleanText(order.purchase_rate),
        cleanText(reason) || cleanText(order.out_of_stock),
        orgId,
      ]
    );
    requestId = String(insert.rows[0].id);

    // Child insert: derive org from the just-created parent request.
    await client.query(
      `INSERT INTO replenishment_status_log (organization_id, replenishment_request_id, from_status, to_status, changed_by, note)
       SELECT rr.organization_id, $1, NULL, 'detected', $2, $3
       FROM replenishment_requests rr
       WHERE rr.id = $1 AND rr.organization_id = $4`,
      [requestId, changedBy, cleanText(reason) || cleanText(order.out_of_stock), orgId]
    );
  }

  // Child insert: derive org from the parent request to keep the line owned
  // by the same tenant.
  await client.query(
    `INSERT INTO replenishment_order_lines (
       organization_id,
       replenishment_request_id,
       order_id,
       channel_order_id,
       quantity_needed
     )
     SELECT rr.organization_id, $1, $2, $3, $4
     FROM replenishment_requests rr
     WHERE rr.id = $1 AND rr.organization_id = $5
     ON CONFLICT (replenishment_request_id, order_id) DO UPDATE SET
       channel_order_id = EXCLUDED.channel_order_id,
       quantity_needed = EXCLUDED.quantity_needed`,
    [requestId, orderId, cleanText(order.order_id), quantityNeeded, orgId]
  );

  await recomputeRequestQuantity(String(requestId), client, orgId);

  if (cleanText(reason)) {
    await client.query(
      `UPDATE replenishment_requests
       SET notes = CASE
           WHEN notes IS NULL OR BTRIM(notes) = '' THEN $2
           WHEN POSITION($2 IN notes) > 0 THEN notes
           ELSE notes || E'\n' || $2
         END,
         updated_at = NOW()
       WHERE id = $1 AND organization_id = $3`,
      [requestId, cleanText(reason), orgId]
    );
  }

  await recalculateNeed(String(requestId), client, orgId);

  return { requestId: String(requestId), skipped: null };
}

export async function ensureReplenishmentForOrder(options: {
  orderId: number;
  reason?: string | null;
  changedBy?: string;
  forceFullQuantity?: boolean;
}, orgId: OrgId) {
  // Run the whole unit of work inside one GUC-scoped transaction.
  return withTenantTransaction(orgId, (client) =>
    ensureReplenishmentForOrderBody(client, options, orgId)
  );
}

async function clearReplenishmentForOrderBody(client: PoolClient, orderId: number, changedBy: string, orgId: OrgId) {
  const orderLinks = await client.query(
    `SELECT replenishment_request_id
     FROM replenishment_order_lines
     WHERE order_id = $1 AND organization_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [orderId, orgId]
  );
  const requestId = orderLinks.rows[0]?.replenishment_request_id as string | null | undefined;

  await client.query(`DELETE FROM replenishment_order_lines WHERE order_id = $1 AND organization_id = $2`, [orderId, orgId]);

  if (requestId) {
    await recomputeRequestQuantity(requestId, client, orgId);
    const req = await client.query(
      `SELECT quantity_needed, status FROM replenishment_requests WHERE id = $1 AND organization_id = $2`,
      [requestId, orgId]
    );
    const quantityNeeded = toNumber(req.rows[0]?.quantity_needed, 0);
    const status = req.rows[0]?.status as ReplenishmentStatus | undefined;

    if (quantityNeeded <= 0 && status && ['detected', 'pending_review', 'planned_for_po'].includes(status)) {
      await transitionReplenishmentStatus(requestId, 'cancelled', changedBy, 'Order no longer requires replenishment', client, orgId);
    }
  }
}

export async function clearReplenishmentForOrder(orderId: number, changedBy = 'staff', orgId: OrgId) {
  return withTenantTransaction(orgId, (client) =>
    clearReplenishmentForOrderBody(client, orderId, changedBy, orgId)
  );
}

export async function listNeedToOrder(options: {
  statuses?: ReplenishmentStatus[];
  page?: number;
  limit?: number;
  skuSearch?: string | null;
  sort?: 'fifo' | 'newest';
}, orgId: OrgId) {
  const statuses = options.statuses?.length ? options.statuses : ACTIVE_STATUSES;
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const page = Math.max(1, options.page ?? 1);
  const offset = (page - 1) * limit;
  const skuSearch = cleanText(options.skuSearch) ?? null;
  const sortDir = options.sort === 'newest' ? 'DESC' : 'ASC'; // FIFO by default

  // Reads gated by rr.organization_id and the string-key JOIN
  // (isc.zoho_item_id = rr.zoho_item_id) aligned on org.
  // Params (rows): $1 statuses, $2 limit, $3 offset, $4 orgId, [$5 skuSearch].
  const rowsParams: unknown[] = [statuses, limit, offset, orgId];
  if (skuSearch) rowsParams.push(skuSearch);
  const skuClause = skuSearch ? `AND (rr.sku ILIKE '%' || $5 || '%' OR rr.item_name ILIKE '%' || $5 || '%')` : '';

  const [rows, count] = await Promise.all([
    withTenantConnection(orgId, (c) => c.query(
      `SELECT
         rr.*,
         isc.open_po_ids,
         isc.sync_error,
         COALESCE((
           SELECT json_agg(
             json_build_object(
               'order_id', rol.order_id,
               'channel_order_id', rol.channel_order_id,
               'quantity', rol.quantity_needed
             )
             ORDER BY rol.created_at ASC
           )
           FROM replenishment_order_lines rol
           WHERE rol.replenishment_request_id = rr.id
             AND rol.organization_id = rr.organization_id
         ), '[]'::json) AS orders_waiting
       FROM replenishment_requests rr
       LEFT JOIN item_stock_cache isc
         ON isc.zoho_item_id = rr.zoho_item_id
         AND isc.organization_id = rr.organization_id
       WHERE rr.status = ANY($1::replenishment_status[])
         AND rr.organization_id = $4
       ${skuClause}
       ORDER BY rr.created_at ${sortDir}
       LIMIT $2 OFFSET $3`,
      rowsParams
    )),
    withTenantConnection(orgId, (c) => c.query(
      `SELECT COUNT(*)::int AS count
       FROM replenishment_requests
       WHERE status = ANY($1::replenishment_status[])
         AND organization_id = $2
       ${skuSearch ? `AND (sku ILIKE '%' || $3 || '%' OR item_name ILIKE '%' || $3 || '%')` : ''}`,
      skuSearch ? [statuses, orgId, skuSearch] : [statuses, orgId]
    )),
  ]);

  return {
    items: rows.rows,
    total: count.rows[0]?.count ?? 0,
    page,
    limit,
  };
}

async function updateNeedToOrderRequestBody(
  client: PoolClient,
  id: string,
  body: {
    quantity_needed?: number;
    status?: ReplenishmentStatus;
    notes?: string | null;
    vendor_zoho_contact_id?: string | null;
    vendor_name?: string | null;
    unit_cost?: number | null;
  },
  changedBy: string,
  orgId: OrgId
) {
  const existing = await client.query(
    `SELECT * FROM replenishment_requests WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [id, orgId]
  );
  const row = existing.rows[0] as ReplenishmentRequestRow | undefined;
  if (!row) throw new Error('Not found');

  if (body.status && body.status !== row.status) {
    await transitionReplenishmentStatus(id, body.status, changedBy, body.notes || null, client, orgId);
  }

  await client.query(
    `UPDATE replenishment_requests
     SET quantity_needed = COALESCE($2, quantity_needed),
         notes = COALESCE($3, notes),
         vendor_zoho_contact_id = COALESCE($4, vendor_zoho_contact_id),
         vendor_name = COALESCE($5, vendor_name),
         unit_cost = COALESCE($6, unit_cost),
         updated_at = NOW()
     WHERE id = $1 AND organization_id = $7`,
    [
      id,
      body.quantity_needed ?? null,
      body.notes === undefined ? null : cleanText(body.notes),
      body.vendor_zoho_contact_id === undefined ? null : cleanText(body.vendor_zoho_contact_id),
      body.vendor_name === undefined ? null : cleanText(body.vendor_name),
      body.unit_cost ?? null,
      orgId,
    ]
  );
}

export async function updateNeedToOrderRequest(
  id: string,
  body: {
    quantity_needed?: number;
    status?: ReplenishmentStatus;
    notes?: string | null;
    vendor_zoho_contact_id?: string | null;
    vendor_name?: string | null;
    unit_cost?: number | null;
  },
  changedBy = 'staff',
  orgId: OrgId
) {
  return withTenantTransaction(orgId, (client) =>
    updateNeedToOrderRequestBody(client, id, body, changedBy, orgId)
  );
}

export async function cancelNeedToOrderRequest(id: string, changedBy = 'staff', orgId: OrgId) {
  // `pool` is the sentinel client: transitionReplenishmentStatus self-wraps in a
  // GUC-scoped transaction for it.
  await transitionReplenishmentStatus(id, 'cancelled', changedBy, 'Manually cancelled', pool, orgId);
}

/**
 * Injectable collaborators for createDraftPurchaseOrders so unit tests run
 * DB-free / Zoho-free (house `Deps` pattern, see backend-patterns.md).
 */
export interface CreateDraftPurchaseOrdersDeps {
  loadRequests: (replenishmentIds: string[], orgId: OrgId) => Promise<ReplenishmentRequestRow[]>;
  createZohoPurchaseOrder: (
    orgId: OrgId,
    payload: {
      vendor_id: string;
      date: string;
      line_items: Array<{ item_id: string; quantity: number; rate: number }>;
      notes: string;
    }
  ) => Promise<{ purchaseorder?: { purchaseorder_id?: string; purchaseorder_number?: string } }>;
  withTenantTransaction: <T>(orgId: OrgId, fn: (client: PoolClient) => Promise<T>) => Promise<T>;
  transitionStatus: typeof transitionReplenishmentStatus;
}

const defaultCreateDraftPurchaseOrdersDeps: CreateDraftPurchaseOrdersDeps = {
  loadRequests: async (replenishmentIds, orgId) => {
    const result = await withTenantConnection(orgId, (c) => c.query(
      `SELECT *
       FROM replenishment_requests
       WHERE id = ANY($1::uuid[])
         AND organization_id = $2`,
      [replenishmentIds, orgId]
    ));
    return result.rows as ReplenishmentRequestRow[];
  },
  createZohoPurchaseOrder: (orgId, payload) =>
    withZohoOrg(orgId, () => zohoPost<{ purchaseorder?: { purchaseorder_id?: string; purchaseorder_number?: string } }>(
      '/api/v1/purchaseorders',
      payload
    )),
  withTenantTransaction,
  transitionStatus: transitionReplenishmentStatus,
};

export async function createDraftPurchaseOrders(
  replenishmentIds: string[],
  orgId: OrgId,
  deps: CreateDraftPurchaseOrdersDeps = defaultCreateDraftPurchaseOrdersDeps
) {
  const requests = await deps.loadRequests(replenishmentIds, orgId);

  const byVendor = new Map<string, ReplenishmentRequestRow[]>();
  for (const request of requests) {
    const vendorId = cleanText(request.vendor_zoho_contact_id);
    if (!vendorId) continue;
    const bucket = byVendor.get(vendorId) ?? [];
    bucket.push(request);
    byVendor.set(vendorId, bucket);
  }

  const createdPos: Array<{ vendor: string | null; zoho_po_id: string; zoho_po_number: string }> = [];

  for (const [vendorId, vendorRequests] of Array.from(byVendor.entries())) {
    const lineItems = vendorRequests
      .map((request: ReplenishmentRequestRow) => ({
        item_id: request.zoho_item_id,
        quantity: Math.max(0, toNumber(request.quantity_to_order, 0)),
        rate: toNumber(request.unit_cost, 0),
      }))
      .filter((entry: { item_id: string; quantity: number; rate: number }) => entry.quantity > 0);

    if (lineItems.length === 0) continue;

    const response = await deps.createZohoPurchaseOrder(orgId, {
      vendor_id: vendorId,
      date: getCurrentPSTDateKey(),
      line_items: lineItems,
      notes: `Auto-generated from Need-to-Order dashboard (${vendorRequests.map((r: ReplenishmentRequestRow) => r.sku || r.item_name).join(', ')})`,
    });

    const poId = cleanText(response.purchaseorder?.purchaseorder_id);
    const poNumber = cleanText(response.purchaseorder?.purchaseorder_number);
    if (!poId || !poNumber) throw new Error('Zoho PO create returned no purchaseorder id/number');

    await deps.withTenantTransaction(orgId, async (client) => {
      for (const request of vendorRequests) {
        await client.query(
          `UPDATE replenishment_requests
           SET zoho_po_id = $2,
               zoho_po_number = $3,
               updated_at = NOW()
           WHERE id = $1 AND organization_id = $4`,
          [request.id, poId, poNumber, orgId]
        );
        await deps.transitionStatus(request.id, 'po_created', 'system', `Zoho PO ${poNumber} created`, client, orgId);
      }
    });

    createdPos.push({ vendor: vendorRequests[0]?.vendor_name ?? null, zoho_po_id: poId, zoho_po_number: poNumber });
  }

  return createdPos;
}

export async function reconcilePOStatus(request: ReplenishmentRequestRow, orgId: OrgId) {
  if (!request.zoho_po_id) return;

  const po = await withZohoOrg(orgId, () => getPurchaseOrderById(request.zoho_po_id!));
  const purchaseOrder = po.purchaseorder;
  if (!purchaseOrder) return;

  const zohoStatus = cleanText(purchaseOrder.status)?.toLowerCase();
  if (zohoStatus === 'cancelled') {
    await withTenantTransaction(orgId, async (client) => {
      await client.query(
        `UPDATE replenishment_requests
         SET zoho_po_id = NULL,
             zoho_po_number = NULL,
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [request.id, orgId]
      );
      await transitionReplenishmentStatus(request.id, 'pending_review', 'system', 'Zoho PO cancelled', client, orgId);
    });
    return;
  }

  if (['open', 'confirmed', 'issued'].includes(zohoStatus || '') && request.status === 'po_created') {
    await transitionReplenishmentStatus(request.id, 'waiting_for_receipt', 'system', null, pool, orgId);
  }

  const receives = await withZohoOrg(orgId, () =>
    listPurchaseReceives({ purchaseorder_id: request.zoho_po_id! })
  );
  const totalReceived = (receives.purchasereceives || []).reduce((sum, receive) => {
    const lines = ((receive.line_items || []) as unknown) as Array<Record<string, unknown>>;
    const line = lines.find((entry) => String(entry.item_id || '') === String(request.zoho_item_id));
    return sum + toNumber(line?.quantity_received, 0);
  }, 0);

  // Also check local receiving_lines for units received against this PO.
  // String-key match (zoho_purchaseorder_id + zoho_item_id) is gated by
  // receiving_lines.organization_id.
  let localReceived = 0;
  if (request.zoho_po_id) {
    const localResult = await withTenantConnection(orgId, (c) => c.query(
      `SELECT COALESCE(SUM(quantity_received), 0)::int AS total
       FROM receiving_lines
       WHERE zoho_purchaseorder_id = $1
         AND zoho_item_id = $2
         AND organization_id = $3
         AND workflow_status = 'DONE'`,
      [request.zoho_po_id, request.zoho_item_id, orgId]
    ));
    localReceived = toNumber(localResult.rows[0]?.total, 0);
  }

  const effectiveReceived = Math.max(totalReceived, localReceived);
  if (effectiveReceived >= toNumber(request.quantity_needed, 0) && request.status !== 'fulfilled') {
    await transitionReplenishmentStatus(request.id, 'fulfilled', 'system', `Received ${effectiveReceived} units`, pool, orgId);
  }
}

export async function runReplenishmentSync(orgId: OrgId) {
  const activeRequests = await withTenantConnection(orgId, (c) => c.query(
    `SELECT * FROM replenishment_requests
     WHERE status = ANY($1::replenishment_status[]) AND organization_id = $2
     ORDER BY created_at ASC`,
    [ACTIVE_STATUSES, orgId]
  ));

  const uniqueZohoItemIds = Array.from(
    new Set(activeRequests.rows.map((row) => String(row.zoho_item_id || '')).filter(Boolean))
  );
  for (const zohoItemId of uniqueZohoItemIds) {
    await refreshStockCacheForItem(zohoItemId, pool, orgId);
  }

  for (const request of activeRequests.rows as ReplenishmentRequestRow[]) {
    if (request.zoho_po_id && ['po_created', 'waiting_for_receipt'].includes(request.status)) {
      await reconcilePOStatus(request, orgId);
    }
    await recalculateNeed(request.id, pool, orgId);
  }
}

export async function backfillLegacyOutOfStockOrders(orgId: OrgId) {
  const rows = await withTenantConnection(orgId, (c) => c.query(
    `SELECT id
     FROM orders
     WHERE COALESCE(BTRIM(out_of_stock), '') <> ''
       AND organization_id = $1
     ORDER BY created_at ASC, id ASC`,
    [orgId]
  ));

  const migrated: number[] = [];
  const skipped: Array<{ orderId: number; reason: string }> = [];

  for (const row of rows.rows) {
    try {
      const result = await ensureReplenishmentForOrder({
        orderId: Number(row.id),
        changedBy: 'migration',
        forceFullQuantity: true,
      }, orgId);

      if (result.requestId) migrated.push(Number(row.id));
      else skipped.push({ orderId: Number(row.id), reason: result.skipped || 'unknown' });
    } catch (error) {
      skipped.push({
        orderId: Number(row.id),
        reason: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  return { migrated, skipped };
}
