import pool from '@/lib/db';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';

export type ExceptionSourceStation = 'tech' | 'packer' | 'verify' | 'mobile';

export interface OrdersExceptionRecord {
  id: number;
  shipping_tracking_number: string;
  source_station: ExceptionSourceStation;
  staff_id: number | null;
  staff_name: string | null;
  exception_reason: string;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

let tableEnsured = false;
type DbClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number }>;
};

export async function findOrderByTrackingKey(
  shippingTrackingNumber: string,
  dbClient: DbClient = pool
): Promise<{ id: number; shipping_tracking_number: string } | null> {
  // Keep tableEnsured variable for backwards compatibility with existing imports/tests.
  // Table creation is handled by migrations, not request-time DDL.
  tableEnsured = true;

  const rawTracking = String(shippingTrackingNumber || '').trim();
  const trackingKey18 = normalizeTrackingKey18(rawTracking);
  if (!trackingKey18) return null;

  const result = await dbClient.query(
    `SELECT id, shipping_tracking_number
     FROM orders
     WHERE shipping_tracking_number IS NOT NULL
       AND shipping_tracking_number != ''
       AND RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
     ORDER BY id DESC
     LIMIT 1`,
    [trackingKey18]
  );

  return result.rows[0] || null;
}

export async function upsertOpenOrderException(params: {
  shippingTrackingNumber: string;
  sourceStation: ExceptionSourceStation;
  staffId?: number | null;
  staffName?: string | null;
  reason?: string;
  notes?: string | null;
}, dbClient: DbClient = pool): Promise<{ exception: OrdersExceptionRecord | null; matchedOrderId: number | null }> {
  tableEnsured = true;

  const tracking = String(params.shippingTrackingNumber || '').trim();
  if (tracking.includes(':')) {
    return { exception: null, matchedOrderId: null };
  }
  const trackingKey18 = normalizeTrackingKey18(tracking);
  if (!tracking || !trackingKey18) {
    return { exception: null, matchedOrderId: null };
  }

  const matchedOrder = await findOrderByTrackingKey(tracking, dbClient);
  if (matchedOrder) {
    return { exception: null, matchedOrderId: matchedOrder.id };
  }

  const existing = await dbClient.query(
    `SELECT *
     FROM orders_exceptions
     WHERE status = 'open'
       AND source_station = $2
       AND RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
     ORDER BY id DESC
     LIMIT 1`,
    [trackingKey18, params.sourceStation]
  );

  if (existing.rows.length > 0) {
    const existingRow = existing.rows[0];
    const updated = await dbClient.query(
      `UPDATE orders_exceptions
       SET shipping_tracking_number = $1,
           source_station = $2,
           staff_id = COALESCE($3, staff_id),
           staff_name = COALESCE($4, staff_name),
           exception_reason = $5,
           notes = COALESCE($6, notes),
           updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        tracking,
        params.sourceStation,
        params.staffId ?? null,
        params.staffName ?? null,
        params.reason || 'not_found',
        params.notes ?? null,
        existingRow.id,
      ]
    );

    return { exception: updated.rows[0], matchedOrderId: null };
  }

  const inserted = await dbClient.query(
    `INSERT INTO orders_exceptions (
      shipping_tracking_number,
      source_station,
      staff_id,
      staff_name,
      exception_reason,
      notes,
      status,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, 'open', NOW(), NOW())
    RETURNING *`,
    [
      tracking,
      params.sourceStation,
      params.staffId ?? null,
      params.staffName ?? null,
      params.reason || 'not_found',
      params.notes ?? null,
    ]
  );

  return { exception: inserted.rows[0], matchedOrderId: null };
}

export async function syncOrderExceptionsToOrders(): Promise<{
  scanned: number;
  matched: number;
  deleted: number;
}> {
  tableEnsured = true;

  const openExceptions = await pool.query(
    `SELECT id, shipping_tracking_number
     FROM orders_exceptions
     WHERE status = 'open'
     ORDER BY id ASC`
  );

  let matched = 0;
  let deleted = 0;

  for (const row of openExceptions.rows) {
    const trackingKey18 = normalizeTrackingKey18(String(row.shipping_tracking_number || ''));
    if (!trackingKey18) continue;

    const orderMatch = await pool.query(
      `SELECT id, shipping_tracking_number, is_shipped
       FROM orders
       WHERE shipping_tracking_number IS NOT NULL
         AND shipping_tracking_number != ''
         AND RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
       ORDER BY id DESC
       LIMIT 1`,
      [trackingKey18]
    );

    if (orderMatch.rows.length === 0) continue;

    matched += 1;
    const order = orderMatch.rows[0];

    await pool.query(
      `UPDATE orders
       SET shipping_tracking_number = COALESCE(NULLIF(shipping_tracking_number, ''), $1),
           is_shipped = CASE
             WHEN EXISTS (
               SELECT 1 FROM packer_logs pl
               WHERE RIGHT(regexp_replace(UPPER(COALESCE(pl.shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $2
                 AND pl.tracking_type = 'ORDERS'
             ) THEN true
             ELSE is_shipped
           END,
           status = CASE
             WHEN EXISTS (
               SELECT 1 FROM packer_logs pl
               WHERE RIGHT(regexp_replace(UPPER(COALESCE(pl.shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $2
                 AND pl.tracking_type = 'ORDERS'
             ) THEN 'shipped'
             ELSE status
           END
       WHERE id = $3`,
      [String(row.shipping_tracking_number || ''), trackingKey18, order.id]
    );

    const deletedResult = await pool.query(
      `DELETE FROM orders_exceptions WHERE id = $1`,
      [row.id]
    );

    deleted += deletedResult.rowCount || 0;
  }

  return {
    scanned: openExceptions.rows.length,
    matched,
    deleted,
  };
}
