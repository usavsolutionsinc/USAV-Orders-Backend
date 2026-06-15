import pool from '@/lib/db';
import { tenantQuery, withTenantTransaction } from '@/lib/tenancy/db';
import type { OrgId } from '@/lib/tenancy/constants';

// NOTE: `square_transactions` is tenant-owned but does NOT yet carry its own
// `organization_id` column (see docs/tenancy/org-id-coverage.generated.md:
// "tenant-owned-NEEDS-COL"), and it has no parent table to derive org from —
// it is a top-level mirror of Square orders. So we cannot add an explicit
// `AND organization_id = $n` predicate or stamp the column on INSERT here yet;
// that work is blocked on the schema migration that adds the column.
//
// What we DO is route every call through the tenant-aware helpers when an
// `orgId` is supplied so the `app.current_org` GUC is set for the duration of
// the query. That makes these paths GUC-safe today and RLS-ready the moment the
// column + FORCE policy land (Phase E). `orgId` is OPTIONAL so the out-of-fileset
// callers (api/walk-in/receipt/[id], api/webhooks/square) keep byte-identical
// raw-pool behavior until they are threaded too.

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
}, orgId?: OrgId): Promise<SquareTransactionRecord[]> {
  const { search, status, weekStart, weekEnd, orderSource, limit = 200 } = params;
  const safeLimit = Math.max(1, Math.min(500, limit));

  // Hide soft-deleted (operator-removed) sales. Always applied.
  const conditions: string[] = ['deleted_at IS NULL'];
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
  const sql = `SELECT * FROM square_transactions ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex}`;
  const result = orgId
    ? await tenantQuery<SquareTransactionRecord>(orgId, sql, values)
    : await pool.query(sql, values);

  return result.rows;
}

export async function getSquareTransactionById(
  id: string,
  orgId?: OrgId,
): Promise<SquareTransactionRecord | null> {
  const sql = 'SELECT * FROM square_transactions WHERE id = $1 LIMIT 1';
  const result = orgId
    ? await tenantQuery<SquareTransactionRecord>(orgId, sql, [id])
    : await pool.query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Soft-delete a walk-in sale (set deleted_at). Square stays the system of
 * record — the row is only hidden locally; re-syncs preserve the flag because
 * the upsert's ON CONFLICT never touches deleted_at. Returns the hidden row,
 * or null if it didn't exist / was already hidden.
 */
export async function softDeleteSquareTransaction(
  id: string,
  orgId?: OrgId,
): Promise<SquareTransactionRecord | null> {
  const sql = `UPDATE square_transactions
        SET deleted_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *`;
  if (orgId) {
    return withTenantTransaction(orgId, async (client) => {
      const result = await client.query<SquareTransactionRecord>(sql, [id]);
      return result.rows[0] || null;
    });
  }
  const result = await pool.query(sql, [id]);
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
}, orgId?: OrgId): Promise<SquareTransactionRecord> {
  const sql = `INSERT INTO square_transactions (
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
    RETURNING *`;
  const values = [
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
  ];

  if (orgId) {
    return withTenantTransaction(orgId, async (client) => {
      const result = await client.query<SquareTransactionRecord>(sql, values);
      return result.rows[0];
    });
  }

  const result = await pool.query<SquareTransactionRecord>(sql, values);
  return result.rows[0];
}
