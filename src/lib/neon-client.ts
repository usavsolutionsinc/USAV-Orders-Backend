/**
 * Enhanced Neon DB client — server-side only.
 *
 * Provides:
 *   - `pool`         pg.Pool instance (connection-pooled, PST timezone set)
 *   - `query<T>`     Type-safe tagged-template helper (parameterised, injection-safe)
 *   - `queryRaw<T>`  Plain string + params helper for dynamic SQL
 *   - `queryOne<T>`  Returns first row or null
 *   - `queryCount`   Returns COUNT(*) as a number
 *   - `transaction`  BEGIN/COMMIT/ROLLBACK wrapper with automatic cleanup
 *
 * Usage:
 *   import { query, transaction, queryOne } from '@/lib/neon-client';
 *
 *   const orders = await query<Order>`SELECT * FROM orders WHERE id = ${id}`;
 *
 *   await transaction(async (client) => {
 *     await client.query('UPDATE orders SET status = $1 WHERE id = $2', ['done', id]);
 *     await client.query('INSERT INTO station_activity_logs (order_id) VALUES ($1)', [id]);
 *   });
 *
 * Environment:
 *   DATABASE_URL must be set. Never import this in client components.
 */

import { Pool, type PoolClient, type QueryResultRow } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL && process.env.NODE_ENV !== 'test') {
  throw new Error('[neon-client] DATABASE_URL environment variable is not set');
}

// ─── Pooled client (transactions + high-frequency queries) ────────────────────

export const pool = new Pool({
  connectionString: DATABASE_URL ?? 'postgres://localhost:5432/postgres',
  ssl: DATABASE_URL ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 4000,
  query_timeout: 8000,
  statement_timeout: 8000,
  idle_in_transaction_session_timeout: 8000,
  options: '-c timezone=America/Los_Angeles',
  // Keep a small pool — Neon serverless handles connection management
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  handleDbError(err, 'pool:idle');
});

// ─── Tagged-template query helper ─────────────────────────────────────────────

/**
 * Executes a parameterised SQL query via the connection pool.
 * Use tagged-template syntax for automatic parameter binding.
 *
 * @example
 * const rows = await query<Order>`
 *   SELECT * FROM orders WHERE id = ${orderId} AND status = ${'open'}
 * `;
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  // Build parameterised query from template literal
  const text = strings.reduce(
    (acc, str, i) => acc + str + (i < values.length ? `$${i + 1}` : ''),
    '',
  );
  try {
    const result = await pool.query<T>(text, values);
    return result.rows;
  } catch (err) {
    handleDbError(err, 'query');
    throw err;
  }
}

/**
 * Executes a query from a plain string + params array.
 * Prefer the tagged-template `query` above; use this for dynamic SQL.
 *
 * @example
 * const rows = await queryRaw<Order>('SELECT * FROM orders WHERE id = $1', [orderId]);
 */
export async function queryRaw<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    const result = await pool.query<T>(text, params);
    return result.rows;
  } catch (err) {
    handleDbError(err, 'queryRaw');
    throw err;
  }
}

// ─── Transaction helper ────────────────────────────────────────────────────────

/**
 * Runs `fn` inside a database transaction.
 * Automatically COMMITs on success and ROLLBACKs on any thrown error.
 *
 * @example
 * const result = await transaction(async (client) => {
 *   await client.query('UPDATE orders SET status = $1 WHERE id = $2', ['done', id]);
 *   await client.query('INSERT INTO station_activity_logs (order_id) VALUES ($1)', [id]);
 *   return { success: true };
 * });
 */
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    handleDbError(err, 'transaction');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Query performance helpers ────────────────────────────────────────────────

/**
 * Executes a query and returns the first row, or null if no rows found.
 */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T | null> {
  const rows = await query<T>(strings, ...values);
  return rows[0] ?? null;
}

/**
 * Returns the count from a `SELECT COUNT(*)` query as a number.
 */
export async function queryCount(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<number> {
  const rows = await query<{ count: string }>(strings, ...values);
  return parseInt(rows[0]?.count ?? '0', 10);
}

// ─── Error handling ───────────────────────────────────────────────────────────

function handleDbError(err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  if (process.env.NODE_ENV === 'development') {
    console.error(`[DB Error] ${context}:`, message, err);
  } else {
    console.error(`[DB Error] ${context}: ${message}`);
  }
}

// ─── Default export (backwards-compatible with existing imports) ───────────────
export default pool;
