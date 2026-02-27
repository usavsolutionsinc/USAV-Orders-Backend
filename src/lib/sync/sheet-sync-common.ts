export function getTrackingLast8(value: string): string {
  return String(value || '').replace(/\D/g, '').slice(-8);
}

export function parseSheetDateTime(rawValue: string): Date | null {
  const value = String(rawValue || '').trim();
  if (!value) return null;

  // Supports common sheet format: M/D/YYYY HH:mm:ss
  if (value.includes('/')) {
    const [datePart, timePartRaw] = value.split(' ');
    const [m, d, y] = String(datePart || '').split('/');
    const timePart = timePartRaw || '00:00:00';
    const asIsoLike = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${timePart}`;
    const parsed = new Date(asIsoLike);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function ensureOrdersExceptionsTable(client: any): Promise<void> {
  await client.query(`
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
}

export async function hasOrderByTracking(client: any, shippingTracking: string): Promise<boolean> {
  const tracking = String(shippingTracking || '').trim();
  if (!tracking) return false;

  const trackingLast8 = getTrackingLast8(tracking);
  if (trackingLast8.length === 8) {
    const result = await client.query(
      `SELECT id
       FROM orders
       WHERE shipping_tracking_number IS NOT NULL
         AND shipping_tracking_number != ''
         AND RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '\\D', '', 'g'), 8) = $1
       LIMIT 1`,
      [trackingLast8]
    );
    return result.rows.length > 0;
  }

  const fallback = await client.query(
    `SELECT id
     FROM orders
     WHERE UPPER(TRIM(COALESCE(shipping_tracking_number, ''))) = UPPER(TRIM($1))
     LIMIT 1`,
    [tracking]
  );
  return fallback.rows.length > 0;
}

export async function hasFbaFnsku(client: any, tracking: string): Promise<boolean> {
  const normalized = String(tracking || '').trim().toUpperCase();
  if (!normalized) return false;

  try {
    const primary = await client.query(
      `SELECT 1
       FROM fba_fnskus
       WHERE UPPER(TRIM(COALESCE(fnsku, ''))) = $1
       LIMIT 1`,
      [normalized]
    );
    if (primary.rows.length > 0) return true;
  } catch (err: any) {
    if (err?.code !== '42P01') throw err;
  }

  try {
    const fallback = await client.query(
      `SELECT 1
       FROM fba_fnsku
       WHERE UPPER(TRIM(COALESCE(fnsku, ''))) = $1
       LIMIT 1`,
      [normalized]
    );
    return fallback.rows.length > 0;
  } catch (err: any) {
    if (err?.code === '42P01') return false;
    throw err;
  }
}

export async function upsertOpenOrdersException(params: {
  client: any;
  shippingTrackingNumber: string;
  sourceStation: 'tech' | 'packer';
  staffId?: number | null;
}): Promise<void> {
  const tracking = String(params.shippingTrackingNumber || '').trim();
  if (!tracking || tracking.includes(':')) return;

  const trackingLast8 = getTrackingLast8(tracking);

  let existing;
  if (trackingLast8.length === 8) {
    existing = await params.client.query(
      `SELECT id
       FROM orders_exceptions
       WHERE status = 'open'
         AND RIGHT(regexp_replace(COALESCE(shipping_tracking_number, ''), '\\D', '', 'g'), 8) = $1
       ORDER BY id DESC
       LIMIT 1`,
      [trackingLast8]
    );
  } else {
    existing = await params.client.query(
      `SELECT id
       FROM orders_exceptions
       WHERE status = 'open'
         AND UPPER(TRIM(COALESCE(shipping_tracking_number, ''))) = UPPER(TRIM($1))
       ORDER BY id DESC
       LIMIT 1`,
      [tracking]
    );
  }

  if (existing.rows.length > 0) {
    await params.client.query(
      `UPDATE orders_exceptions
       SET shipping_tracking_number = $1,
           source_station = $2,
           staff_id = COALESCE($3, staff_id),
           exception_reason = 'not_found',
           updated_at = NOW()
       WHERE id = $4`,
      [tracking, params.sourceStation, params.staffId, existing.rows[0].id]
    );
    return;
  }

  await params.client.query(
    `INSERT INTO orders_exceptions (
      shipping_tracking_number,
      source_station,
      staff_id,
      exception_reason,
      status,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, 'not_found', 'open', NOW(), NOW())`,
    [tracking, params.sourceStation, params.staffId]
  );
}
