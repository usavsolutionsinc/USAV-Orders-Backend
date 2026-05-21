/**
 * receiving-schema-cache.ts
 * ─────────────────────────────────────────────────────────────────
 * In-memory cache for receiving table schema introspection.
 *
 * All receiving API routes need to know which columns exist in
 * `receiving` and `receiving_lines` to build dynamic queries.
 * Querying information_schema on every request adds 2-6 round-trips.
 * This module caches the result for 5 minutes.
 * ─────────────────────────────────────────────────────────────────
 */

import pool from '@/lib/db';
import { resolveReceivingSchema } from '@/utils/receiving-schema';

const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

// ─── Receiving table columns ────────────────────────────────────────────────

let _receivingColumns: Set<string> | null = null;
let _receivingDateColumn: string | null = null;
let _receivingHasQuantity: boolean | null = null;
let _receivingExpiry = 0;

export async function getReceivingSchema(): Promise<{
  columns: Set<string>;
  dateColumn: string;
  hasQuantity: boolean;
}> {
  const now = Date.now();
  if (_receivingColumns && _receivingDateColumn !== null && _receivingHasQuantity !== null && now < _receivingExpiry) {
    return { columns: _receivingColumns, dateColumn: _receivingDateColumn, hasQuantity: _receivingHasQuantity };
  }

  const [schema, columnsRes] = await Promise.all([
    resolveReceivingSchema(),
    pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'receiving'`),
  ]);

  _receivingColumns = new Set<string>(columnsRes.rows.map((r: any) => String(r.column_name)));
  _receivingDateColumn = schema.dateColumn;
  _receivingHasQuantity = schema.hasQuantity;
  _receivingExpiry = now + CACHE_TTL_MS;

  return { columns: _receivingColumns, dateColumn: _receivingDateColumn, hasQuantity: _receivingHasQuantity };
}

// ─── Receiving lines table columns ──────────────────────────────────────────

let _lineColumns: Set<string> | null = null;
let _lineExpiry = 0;

export async function getReceivingLineColumns(): Promise<Set<string>> {
  const now = Date.now();
  if (_lineColumns && now < _lineExpiry) {
    return _lineColumns;
  }

  const res = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'receiving_lines'`
  );
  _lineColumns = new Set<string>(res.rows.map((r: any) => String(r.column_name)));
  _lineExpiry = now + CACHE_TTL_MS;

  return _lineColumns;
}

// Bust both caches (used when callers detect a schema drift, e.g. a column
// they depend on is missing). Next call re-probes information_schema.
export function bustReceivingSchemaCache(reason: string): void {
  console.warn('[receiving-schema-cache] bust', { reason });
  _receivingColumns = null;
  _receivingDateColumn = null;
  _receivingHasQuantity = null;
  _receivingExpiry = 0;
  _lineColumns = null;
  _lineExpiry = 0;
}

// One-shot per-process logger so we don't spam logs every request. Records
// the missing column name + which side (receiving / receiving_lines) so ops
// can spot schema drift in monitoring.
const _missingColumnsLogged = new Set<string>();
export function reportMissingReceivingColumn(table: 'receiving' | 'receiving_lines', column: string): void {
  const key = `${table}:${column}`;
  if (_missingColumnsLogged.has(key)) return;
  _missingColumnsLogged.add(key);
  console.warn('[receiving-schema-cache] expected column missing — query falling back', { table, column });
}
