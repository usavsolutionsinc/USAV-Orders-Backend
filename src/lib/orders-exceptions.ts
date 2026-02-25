import pool from '@/lib/db';
import { normalizeTrackingLast8 } from '@/lib/tracking-format';

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

async function ensureOrdersExceptionsTable(): Promise<void> {
  if (tableEnsured) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders_exceptions (
      id SERIAL PRIMARY KEY,
      shipping_tracking_number TEXT NOT NULL,
      source_station VARCHAR(20) NOT NULL,
      staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
      staff_name TEXT,
      exception_reason VARCHAR(50) NOT NULL DEFAULT 'not_found',
      notes TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_exceptions_status ON orders_exceptions(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_exceptions_tracking ON orders_exceptions(shipping_tracking_number)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_exceptions_source_status ON orders_exceptions(source_station, status)`);

  tableEnsured = true;
}

export async function findOrderByTrackingKey(shippingTrackingNumber: string): Promise<{ id: number; shipping_tracking_number: string } | null> {
  await ensureOrdersExceptionsTable();

  const rawTracking = String(shippingTrackingNumber || '').trim();
  const trackingLast8 = normalizeTrackingLast8(rawTracking);
  if (!trackingLast8 || trackingLast8.length < 8) return null;

  const result = await pool.query(
    `SELECT id, shipping_tracking_number
     FROM orders
     WHERE shipping_tracking_number IS NOT NULL
       AND shipping_tracking_number != ''
       AND RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '\\D', '', 'g'), 8) = $1
     ORDER BY id DESC
     LIMIT 1`,
    [trackingLast8]
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
}): Promise<{ exception: OrdersExceptionRecord | null; matchedOrderId: number | null }> {
  await ensureOrdersExceptionsTable();

  const tracking = String(params.shippingTrackingNumber || '').trim();
  if (tracking.includes(':')) {
    return { exception: null, matchedOrderId: null };
  }
  const normalizedDigits = tracking.replace(/\D/g, '');
  const trackingLast8 = normalizeTrackingLast8(tracking);
  if (!tracking || !trackingLast8 || normalizedDigits.length < 8) {
    return { exception: null, matchedOrderId: null };
  }

  const matchedOrder = await findOrderByTrackingKey(tracking);
  if (matchedOrder) {
    return { exception: null, matchedOrderId: matchedOrder.id };
  }

  const existing = await pool.query(
    `SELECT *
     FROM orders_exceptions
     WHERE status = 'open'
       AND RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '\\D', '', 'g'), 8) = $1
     ORDER BY id DESC
     LIMIT 1`,
    [trackingLast8]
  );

  if (existing.rows.length > 0) {
    const existingRow = existing.rows[0];
    const updated = await pool.query(
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

  const inserted = await pool.query(
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
  await ensureOrdersExceptionsTable();

  const openExceptions = await pool.query(
    `SELECT id, shipping_tracking_number
     FROM orders_exceptions
     WHERE status = 'open'
     ORDER BY id ASC`
  );

  let matched = 0;
  let deleted = 0;

  for (const row of openExceptions.rows) {
    const trackingLast8 = normalizeTrackingLast8(String(row.shipping_tracking_number || ''));
    if (!trackingLast8 || trackingLast8.length < 8) continue;

    const orderMatch = await pool.query(
      `SELECT id, shipping_tracking_number, is_shipped
       FROM orders
       WHERE shipping_tracking_number IS NOT NULL
         AND shipping_tracking_number != ''
         AND RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '\\D', '', 'g'), 8) = $1
       ORDER BY id DESC
       LIMIT 1`,
      [trackingLast8]
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
               WHERE RIGHT(regexp_replace(COALESCE(pl.shipping_tracking_number, ''), '\\D', '', 'g'), 8) = $2
                 AND pl.tracking_type = 'ORDERS'
             ) THEN true
             ELSE is_shipped
           END,
           status = CASE
             WHEN EXISTS (
               SELECT 1 FROM packer_logs pl
               WHERE RIGHT(regexp_replace(COALESCE(pl.shipping_tracking_number, ''), '\\D', '', 'g'), 8) = $2
                 AND pl.tracking_type = 'ORDERS'
             ) THEN 'shipped'
             ELSE status
           END
       WHERE id = $3`,
      [String(row.shipping_tracking_number || ''), trackingLast8, order.id]
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
