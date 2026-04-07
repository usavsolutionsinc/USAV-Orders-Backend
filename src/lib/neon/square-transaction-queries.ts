import pool from '@/lib/db';

export interface SquareTransactionRecord {
  id: string;
  square_order_id: string;
  square_payment_id: string | null;
  square_customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  line_items: Array<{
    name: string;
    sku: string | null;
    quantity: string;
    price: number;
  }>;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  discount: number;
  status: string;
  payment_method: string | null;
  receipt_url: string | null;
  order_source: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  synced_at: string;
}

export async function getSquareTransactions(params: {
  search?: string;
  status?: string;
  weekStart?: string;
  weekEnd?: string;
  orderSource?: string;
  limit?: number;
}): Promise<SquareTransactionRecord[]> {
  const { search, status, weekStart, weekEnd, orderSource, limit = 200 } = params;
  const safeLimit = Math.max(1, Math.min(500, limit));

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (search) {
    conditions.push(
      `(customer_name ILIKE $${paramIndex} OR customer_phone ILIKE $${paramIndex} OR customer_email ILIKE $${paramIndex} OR square_order_id ILIKE $${paramIndex} OR line_items::text ILIKE $${paramIndex})`,
    );
    values.push(`%${search}%`);
    paramIndex++;
  }

  if (status) {
    conditions.push(`status = $${paramIndex}`);
    values.push(status);
    paramIndex++;
  }

  if (weekStart) {
    conditions.push(`created_at >= $${paramIndex}::date`);
    values.push(weekStart);
    paramIndex++;
  }

  if (weekEnd) {
    conditions.push(`created_at < ($${paramIndex}::date + interval '1 day')`);
    values.push(weekEnd);
    paramIndex++;
  }

  if (orderSource) {
    conditions.push(`order_source = $${paramIndex}`);
    values.push(orderSource);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  values.push(safeLimit);
  const result = await pool.query(
    `SELECT * FROM square_transactions ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex}`,
    values,
  );

  return result.rows;
}

export async function getSquareTransactionById(
  id: string,
): Promise<SquareTransactionRecord | null> {
  const result = await pool.query(
    'SELECT * FROM square_transactions WHERE id = $1 LIMIT 1',
    [id],
  );
  return result.rows[0] || null;
}

export async function insertSquareTransaction(data: {
  square_order_id: string;
  square_payment_id?: string | null;
  square_customer_id?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  line_items: unknown[];
  subtotal?: number | null;
  tax?: number | null;
  total?: number | null;
  discount?: number;
  status?: string;
  payment_method?: string | null;
  receipt_url?: string | null;
  order_source?: string;
  notes?: string | null;
  created_by?: string | null;
  created_at?: string | null;
}): Promise<SquareTransactionRecord> {
  const result = await pool.query(
    `INSERT INTO square_transactions (
      square_order_id, square_payment_id, square_customer_id,
      customer_name, customer_email, customer_phone,
      line_items, subtotal, tax, total, discount,
      status, payment_method, receipt_url, order_source,
      notes, created_by, created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7::jsonb, $8, $9, $10, $11,
      $12, $13, $14, $15,
      $16, $17, COALESCE($18::timestamptz, now())
    )
    ON CONFLICT (square_order_id) DO UPDATE SET
      square_payment_id = COALESCE(EXCLUDED.square_payment_id, square_transactions.square_payment_id),
      status = COALESCE(EXCLUDED.status, square_transactions.status),
      receipt_url = COALESCE(EXCLUDED.receipt_url, square_transactions.receipt_url),
      created_at = COALESCE(EXCLUDED.created_at, square_transactions.created_at),
      synced_at = now()
    RETURNING *`,
    [
      data.square_order_id,
      data.square_payment_id ?? null,
      data.square_customer_id ?? null,
      data.customer_name ?? null,
      data.customer_email ?? null,
      data.customer_phone ?? null,
      JSON.stringify(data.line_items),
      data.subtotal ?? null,
      data.tax ?? null,
      data.total ?? null,
      data.discount ?? 0,
      data.status ?? 'completed',
      data.payment_method ?? null,
      data.receipt_url ?? null,
      data.order_source ?? 'walk_in_sale',
      data.notes ?? null,
      data.created_by ?? null,
      data.created_at ?? null,
    ],
  );

  return result.rows[0];
}
