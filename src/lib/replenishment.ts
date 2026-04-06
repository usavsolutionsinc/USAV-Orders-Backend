import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { getCurrentPSTDateKey } from '@/utils/date';
import { getPurchaseOrderById, listPurchaseOrders, listPurchaseReceives } from '@/lib/zoho';
import { zohoGet, zohoPost } from '@/lib/zoho/httpClient';

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

type DbClient = Pick<PoolClient, 'query'> | typeof pool;

const ACTIVE_STATUSES: ReplenishmentStatus[] = [
  'detected',
  'pending_review',
  'planned_for_po',
  'po_created',
  'waiting_for_receipt',
];

const ALLOWED_TRANSITIONS: Record<ReplenishmentStatus, ReplenishmentStatus[]> = {
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

async function getOrderItemContext(orderId: number, client: DbClient = pool) {
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
     LEFT JOIN items i ON i.sku = o.sku
     WHERE o.id = $1
     LIMIT 1`,
    [orderId]
  );

  return result.rows[0] ?? null;
}

export async function getItemStock(zohoItemId: string): Promise<{
  zohoItemId: string;
  name: string;
  quantityAvailable: number;
  quantityOnHand: number;
}> {
  const res = await zohoGet<{ item?: Record<string, unknown> }>(`/api/v1/items/${encodeURIComponent(zohoItemId)}`);
  const item = res.item;
  if (!item) throw new Error(`Zoho item not found: ${zohoItemId}`);

  return {
    zohoItemId: String(item.item_id || zohoItemId),
    name: String(item.name || ''),
    quantityAvailable: toNumber(item.available_stock, 0),
    quantityOnHand: toNumber(item.stock_on_hand, 0),
  };
}

export async function getIncomingQuantityForItem(zohoItemId: string): Promise<{ incomingQty: number; openPoIds: string[] }> {
  const statuses = ['open', 'confirmed'];
  let incomingQty = 0;
  const openPoIds = new Set<string>();

  for (const status of statuses) {
    const res = await zohoGet<{ purchaseorders?: Array<{ purchaseorder_id?: string; line_items?: Array<{ item_id?: string; quantity?: number; quantity_received?: number }> }> }>(
      '/api/v1/purchaseorders',
      { status, item_id: zohoItemId, per_page: 200 }
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

export async function refreshStockCacheForItem(zohoItemId: string, client: DbClient = pool) {
  const itemLookup = await client.query(
    `SELECT id, quantity_available, quantity_on_hand FROM items WHERE zoho_item_id = $1 LIMIT 1`,
    [zohoItemId]
  );
  const localItem = itemLookup.rows[0] ?? null;

  try {
    const [stock, incoming] = await Promise.all([
      getItemStock(zohoItemId),
      getIncomingQuantityForItem(zohoItemId),
    ]);

    const upsert = await client.query(
      `INSERT INTO item_stock_cache (
         zoho_item_id, item_id, quantity_available, quantity_on_hand, incoming_quantity, open_po_ids, sync_error, last_synced_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NULL, NOW())
       ON CONFLICT (zoho_item_id) DO UPDATE SET
         item_id = EXCLUDED.item_id,
         quantity_available = EXCLUDED.quantity_available,
         quantity_on_hand = EXCLUDED.quantity_on_hand,
         incoming_quantity = EXCLUDED.incoming_quantity,
         open_po_ids = EXCLUDED.open_po_ids,
         sync_error = NULL,
         last_synced_at = NOW()
       RETURNING *`,
      [zohoItemId, localItem?.id ?? null, stock.quantityAvailable, stock.quantityOnHand, incoming.incomingQty, incoming.openPoIds]
    );

    await client.query(
      `UPDATE replenishment_requests
       SET zoho_quantity_available = $2,
           zoho_quantity_on_hand = $3,
           zoho_incoming_quantity = $4,
           updated_at = NOW()
       WHERE zoho_item_id = $1
         AND status <> 'fulfilled'
         AND status <> 'cancelled'`,
      [zohoItemId, stock.quantityAvailable, stock.quantityOnHand, incoming.incomingQty]
    );

    return upsert.rows[0];
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Zoho sync error';
    const fallbackAvailable = toNumber(localItem?.quantity_available, 0);
    const fallbackOnHand = toNumber(localItem?.quantity_on_hand, 0);

    const upsert = await client.query(
      `INSERT INTO item_stock_cache (
         zoho_item_id, item_id, quantity_available, quantity_on_hand, incoming_quantity, open_po_ids, sync_error, last_synced_at
       ) VALUES ($1, $2, $3, $4, 0, NULL, $5, NULL)
       ON CONFLICT (zoho_item_id) DO UPDATE SET
         item_id = EXCLUDED.item_id,
         quantity_available = EXCLUDED.quantity_available,
         quantity_on_hand = EXCLUDED.quantity_on_hand,
         sync_error = EXCLUDED.sync_error
       RETURNING *`,
      [zohoItemId, localItem?.id ?? null, fallbackAvailable, fallbackOnHand, message]
    );

    return upsert.rows[0];
  }
}

export async function getOrRefreshStockCache(zohoItemId: string, client: DbClient = pool) {
  const result = await client.query(
    `SELECT * FROM item_stock_cache WHERE zoho_item_id = $1 LIMIT 1`,
    [zohoItemId]
  );
  const existing = result.rows[0] ?? null;

  const stale = !existing?.last_synced_at || (Date.now() - new Date(existing.last_synced_at).getTime()) > 10 * 60 * 1000;
  if (!stale) return existing;

  return refreshStockCacheForItem(zohoItemId, client);
}

export async function findActiveRequestForItem(zohoItemId: string, client: DbClient = pool): Promise<ReplenishmentRequestRow | null> {
  const result = await client.query(
    `SELECT *
     FROM replenishment_requests
     WHERE zoho_item_id = $1
       AND status = ANY($2::replenishment_status[])
     ORDER BY created_at DESC
     LIMIT 1`,
    [zohoItemId, ACTIVE_STATUSES]
  );
  return (result.rows[0] as ReplenishmentRequestRow | undefined) ?? null;
}

async function recomputeRequestQuantity(requestId: string, client: DbClient = pool) {
  await client.query(
    `UPDATE replenishment_requests rr
     SET quantity_needed = COALESCE((
           SELECT SUM(rol.quantity_needed)
           FROM replenishment_order_lines rol
           WHERE rol.replenishment_request_id = rr.id
         ), 0),
         updated_at = NOW()
     WHERE rr.id = $1`,
    [requestId]
  );
}

export async function transitionReplenishmentStatus(
  requestId: string,
  nextStatus: ReplenishmentStatus,
  changedBy: string,
  note?: string | null,
  client: DbClient = pool
) {
  const result = await client.query(
    `SELECT id, status FROM replenishment_requests WHERE id = $1 LIMIT 1`,
    [requestId]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Replenishment request not found');

  const current = row.status as ReplenishmentStatus;
  if (current === nextStatus) return;
  if (!ALLOWED_TRANSITIONS[current].includes(nextStatus)) {
    throw new Error(`Invalid replenishment transition: ${current} -> ${nextStatus}`);
  }

  await client.query(
    `UPDATE replenishment_requests
     SET status = $2, status_changed_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [requestId, nextStatus]
  );

  await client.query(
    `INSERT INTO replenishment_status_log (replenishment_request_id, from_status, to_status, changed_by, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [requestId, current, nextStatus, changedBy, cleanText(note)]
  );
}

export async function recalculateNeed(requestId: string, client: DbClient = pool) {
  const result = await client.query(
    `SELECT * FROM replenishment_requests WHERE id = $1 LIMIT 1`,
    [requestId]
  );
  const request = result.rows[0] as ReplenishmentRequestRow | undefined;
  if (!request) return;

  const stock = await getOrRefreshStockCache(request.zoho_item_id, client);
  const effectiveShortfall = Math.max(
    0,
    toNumber(request.quantity_needed, 0) -
      toNumber(stock?.quantity_available, 0) -
      toNumber(stock?.incoming_quantity, 0)
  );

  await client.query(
    `UPDATE replenishment_requests
     SET zoho_quantity_available = $2,
         zoho_quantity_on_hand = $3,
         zoho_incoming_quantity = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [requestId, toNumber(stock?.quantity_available, 0), toNumber(stock?.quantity_on_hand, 0), toNumber(stock?.incoming_quantity, 0)]
  );

  if (effectiveShortfall === 0 && ['detected', 'pending_review'].includes(request.status)) {
    await transitionReplenishmentStatus(requestId, 'cancelled', 'system', 'Incoming stock already covers demand', client);
  }
}

export async function ensureReplenishmentForOrder(options: {
  orderId: number;
  reason?: string | null;
  changedBy?: string;
  forceFullQuantity?: boolean;
}) {
  const { orderId, reason, changedBy = 'system', forceFullQuantity = false } = options;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const order = await getOrderItemContext(orderId, client);
    if (!order) {
      await client.query('ROLLBACK');
      return { requestId: null, skipped: 'order_not_found' as const };
    }

    if (!order.item_id || !order.zoho_item_id) {
      await client.query('ROLLBACK');
      return { requestId: null, skipped: 'item_not_linked' as const };
    }

    const stock = await getOrRefreshStockCache(order.zoho_item_id, client);
    const orderQty = normalizeQuantity(order.quantity);
    const shortfall = forceFullQuantity ? orderQty : Math.max(0, orderQty - toNumber(stock?.quantity_available, 0));
    const quantityNeeded = shortfall > 0 ? shortfall : orderQty;

    const existing = await findActiveRequestForItem(order.zoho_item_id, client);
    let requestId = existing?.id ?? null;

    if (!existing) {
      const vendor = itemVendorMetadata(order.custom_fields);
      const insert = await client.query(
        `INSERT INTO replenishment_requests (
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
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'detected', $12)
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
        ]
      );
      requestId = String(insert.rows[0].id);

      await client.query(
        `INSERT INTO replenishment_status_log (replenishment_request_id, from_status, to_status, changed_by, note)
         VALUES ($1, NULL, 'detected', $2, $3)`,
        [requestId, changedBy, cleanText(reason) || cleanText(order.out_of_stock)]
      );
    }

    await client.query(
      `INSERT INTO replenishment_order_lines (
         replenishment_request_id,
         order_id,
         channel_order_id,
         quantity_needed
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (replenishment_request_id, order_id) DO UPDATE SET
         channel_order_id = EXCLUDED.channel_order_id,
         quantity_needed = EXCLUDED.quantity_needed`,
      [requestId, orderId, cleanText(order.order_id), quantityNeeded]
    );

    await recomputeRequestQuantity(String(requestId), client);

    if (cleanText(reason)) {
      await client.query(
        `UPDATE replenishment_requests
         SET notes = CASE
             WHEN notes IS NULL OR BTRIM(notes) = '' THEN $2
             WHEN POSITION($2 IN notes) > 0 THEN notes
             ELSE notes || E'\n' || $2
           END,
           updated_at = NOW()
         WHERE id = $1`,
        [requestId, cleanText(reason)]
      );
    }

    await recalculateNeed(String(requestId), client);
    await client.query('COMMIT');

    return { requestId: String(requestId), skipped: null };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function clearReplenishmentForOrder(orderId: number, changedBy = 'staff') {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderLinks = await client.query(
      `SELECT replenishment_request_id
       FROM replenishment_order_lines
       WHERE order_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [orderId]
    );
    const requestId = orderLinks.rows[0]?.replenishment_request_id as string | null | undefined;

    await client.query(`DELETE FROM replenishment_order_lines WHERE order_id = $1`, [orderId]);

    if (requestId) {
      await recomputeRequestQuantity(requestId, client);
      const req = await client.query(`SELECT quantity_needed, status FROM replenishment_requests WHERE id = $1`, [requestId]);
      const quantityNeeded = toNumber(req.rows[0]?.quantity_needed, 0);
      const status = req.rows[0]?.status as ReplenishmentStatus | undefined;

      if (quantityNeeded <= 0 && status && ['detected', 'pending_review', 'planned_for_po'].includes(status)) {
        await transitionReplenishmentStatus(requestId, 'cancelled', changedBy, 'Order no longer requires replenishment', client);
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listNeedToOrder(options: {
  statuses?: ReplenishmentStatus[];
  page?: number;
  limit?: number;
  skuSearch?: string | null;
  sort?: 'fifo' | 'newest';
}) {
  const statuses = options.statuses?.length ? options.statuses : ACTIVE_STATUSES;
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const page = Math.max(1, options.page ?? 1);
  const offset = (page - 1) * limit;
  const skuSearch = cleanText(options.skuSearch) ?? null;
  const sortDir = options.sort === 'newest' ? 'DESC' : 'ASC'; // FIFO by default

  const skuClause = skuSearch ? `AND (rr.sku ILIKE '%' || $4 || '%' OR rr.item_name ILIKE '%' || $4 || '%')` : '';
  const params: unknown[] = [statuses, limit, offset];
  if (skuSearch) params.push(skuSearch);

  const [rows, count] = await Promise.all([
    pool.query(
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
         ), '[]'::json) AS orders_waiting
       FROM replenishment_requests rr
       LEFT JOIN item_stock_cache isc ON isc.zoho_item_id = rr.zoho_item_id
       WHERE rr.status = ANY($1::replenishment_status[])
       ${skuClause}
       ORDER BY rr.created_at ${sortDir}
       LIMIT $2 OFFSET $3`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM replenishment_requests
       WHERE status = ANY($1::replenishment_status[])
       ${skuSearch ? `AND (sku ILIKE '%' || $2 || '%' OR item_name ILIKE '%' || $2 || '%')` : ''}`,
      skuSearch ? [statuses, skuSearch] : [statuses]
    ),
  ]);

  return {
    items: rows.rows,
    total: count.rows[0]?.count ?? 0,
    page,
    limit,
  };
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
  changedBy = 'staff'
) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const existing = await client.query(`SELECT * FROM replenishment_requests WHERE id = $1 LIMIT 1`, [id]);
    const row = existing.rows[0] as ReplenishmentRequestRow | undefined;
    if (!row) throw new Error('Not found');

    if (body.status && body.status !== row.status) {
      await transitionReplenishmentStatus(id, body.status, changedBy, body.notes || null, client);
    }

    await client.query(
      `UPDATE replenishment_requests
       SET quantity_needed = COALESCE($2, quantity_needed),
           notes = COALESCE($3, notes),
           vendor_zoho_contact_id = COALESCE($4, vendor_zoho_contact_id),
           vendor_name = COALESCE($5, vendor_name),
           unit_cost = COALESCE($6, unit_cost),
           updated_at = NOW()
       WHERE id = $1`,
      [
        id,
        body.quantity_needed ?? null,
        body.notes === undefined ? null : cleanText(body.notes),
        body.vendor_zoho_contact_id === undefined ? null : cleanText(body.vendor_zoho_contact_id),
        body.vendor_name === undefined ? null : cleanText(body.vendor_name),
        body.unit_cost ?? null,
      ]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelNeedToOrderRequest(id: string, changedBy = 'staff') {
  await transitionReplenishmentStatus(id, 'cancelled', changedBy, 'Manually cancelled');
}

export async function createDraftPurchaseOrders(replenishmentIds: string[]) {
  const result = await pool.query(
    `SELECT *
     FROM replenishment_requests
     WHERE id = ANY($1::uuid[])`,
    [replenishmentIds]
  );

  const byVendor = new Map<string, ReplenishmentRequestRow[]>();
  for (const request of result.rows as ReplenishmentRequestRow[]) {
    const vendorId = cleanText(request.vendor_zoho_contact_id);
    if (!vendorId) continue;
    const bucket = byVendor.get(vendorId) ?? [];
    bucket.push(request);
    byVendor.set(vendorId, bucket);
  }

  const createdPos: Array<{ vendor: string | null; zoho_po_id: string; zoho_po_number: string }> = [];

  for (const [vendorId, requests] of Array.from(byVendor.entries())) {
    const lineItems = requests
      .map((request: ReplenishmentRequestRow) => ({
        item_id: request.zoho_item_id,
        quantity: Math.max(0, toNumber(request.quantity_to_order, 0)),
        rate: toNumber(request.unit_cost, 0),
      }))
      .filter((entry: { item_id: string; quantity: number; rate: number }) => entry.quantity > 0);

    if (lineItems.length === 0) continue;

    const response = await zohoPost<{ purchaseorder?: { purchaseorder_id?: string; purchaseorder_number?: string } }>(
      '/api/v1/purchaseorders',
      {
        vendor_id: vendorId,
        date: getCurrentPSTDateKey(),
        line_items: lineItems,
        notes: `Auto-generated from Need-to-Order dashboard (${requests.map((r: ReplenishmentRequestRow) => r.sku || r.item_name).join(', ')})`,
      }
    );

    const poId = cleanText(response.purchaseorder?.purchaseorder_id);
    const poNumber = cleanText(response.purchaseorder?.purchaseorder_number);
    if (!poId || !poNumber) throw new Error('Zoho PO create returned no purchaseorder id/number');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const request of requests) {
        await client.query(
          `UPDATE replenishment_requests
           SET zoho_po_id = $2,
               zoho_po_number = $3,
               updated_at = NOW()
           WHERE id = $1`,
          [request.id, poId, poNumber]
        );
        await transitionReplenishmentStatus(request.id, 'po_created', 'system', `Zoho PO ${poNumber} created`, client);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    createdPos.push({ vendor: requests[0]?.vendor_name ?? null, zoho_po_id: poId, zoho_po_number: poNumber });
  }

  return createdPos;
}

export async function reconcilePOStatus(request: ReplenishmentRequestRow) {
  if (!request.zoho_po_id) return;

  const po = await getPurchaseOrderById(request.zoho_po_id);
  const purchaseOrder = po.purchaseorder;
  if (!purchaseOrder) return;

  const zohoStatus = cleanText(purchaseOrder.status)?.toLowerCase();
  if (zohoStatus === 'cancelled') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE replenishment_requests
         SET zoho_po_id = NULL,
             zoho_po_number = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [request.id]
      );
      await transitionReplenishmentStatus(request.id, 'pending_review', 'system', 'Zoho PO cancelled', client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  if (['open', 'confirmed', 'issued'].includes(zohoStatus || '') && request.status === 'po_created') {
    await transitionReplenishmentStatus(request.id, 'waiting_for_receipt', 'system');
  }

  const receives = await listPurchaseReceives({ purchaseorder_id: request.zoho_po_id });
  const totalReceived = (receives.purchasereceives || []).reduce((sum, receive) => {
    const lines = ((receive.line_items || []) as unknown) as Array<Record<string, unknown>>;
    const line = lines.find((entry) => String(entry.item_id || '') === String(request.zoho_item_id));
    return sum + toNumber(line?.quantity_received, 0);
  }, 0);

  // Also check local receiving_lines for units received against this PO
  let localReceived = 0;
  if (request.zoho_po_id) {
    const localResult = await pool.query(
      `SELECT COALESCE(SUM(quantity_received), 0)::int AS total
       FROM receiving_lines
       WHERE zoho_purchaseorder_id = $1
         AND zoho_item_id = $2
         AND workflow_status = 'DONE'`,
      [request.zoho_po_id, request.zoho_item_id]
    );
    localReceived = toNumber(localResult.rows[0]?.total, 0);
  }

  const effectiveReceived = Math.max(totalReceived, localReceived);
  if (effectiveReceived >= toNumber(request.quantity_needed, 0) && request.status !== 'fulfilled') {
    await transitionReplenishmentStatus(request.id, 'fulfilled', 'system', `Received ${effectiveReceived} units`);
  }
}

export async function runReplenishmentSync() {
  const activeRequests = await pool.query(
    `SELECT * FROM replenishment_requests WHERE status = ANY($1::replenishment_status[]) ORDER BY created_at ASC`,
    [ACTIVE_STATUSES]
  );

  const uniqueZohoItemIds = Array.from(
    new Set(activeRequests.rows.map((row) => String(row.zoho_item_id || '')).filter(Boolean))
  );
  for (const zohoItemId of uniqueZohoItemIds) {
    await refreshStockCacheForItem(zohoItemId);
  }

  for (const request of activeRequests.rows as ReplenishmentRequestRow[]) {
    if (request.zoho_po_id && ['po_created', 'waiting_for_receipt'].includes(request.status)) {
      await reconcilePOStatus(request);
    }
    await recalculateNeed(request.id);
  }
}

export async function backfillLegacyOutOfStockOrders() {
  const rows = await pool.query(
    `SELECT id
     FROM orders
     WHERE COALESCE(BTRIM(out_of_stock), '') <> ''
     ORDER BY created_at ASC, id ASC`
  );

  const migrated: number[] = [];
  const skipped: Array<{ orderId: number; reason: string }> = [];

  for (const row of rows.rows) {
    try {
      const result = await ensureReplenishmentForOrder({
        orderId: Number(row.id),
        changedBy: 'migration',
        forceFullQuantity: true,
      });

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
