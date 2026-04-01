#!/usr/bin/env node
/* eslint-disable no-console */
import path from 'path';
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

function parseDaysArg(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 30;
  return Math.floor(n);
}

async function main() {
  const days = parseDaysArg(process.argv[2] || '30');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set in .env');
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  const fromRes = await (async () => {
    const sql = `SELECT (NOW() - ($1::int * INTERVAL '1 day'))::timestamptz AS from_ts, NOW()::timestamptz AS to_ts`;
    return { sql, values: [days] };
  })();

  await client.connect();
  try {
    const bounds = await client.query(fromRes.sql, fromRes.values);
    const fromTs = bounds.rows[0]?.from_ts;
    const toTs = bounds.rows[0]?.to_ts;
    console.log(`[kpi-rollups] Backfilling ${days} day(s): ${fromTs} -> ${toTs}`);

    const refresh = await client.query(
      `SELECT * FROM refresh_operations_kpi_rollups($1::timestamptz, $2::timestamptz)`,
      [fromTs, toTs],
    );
    console.log('[kpi-rollups] Refresh result:', refresh.rows[0] || null);

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*)::bigint FROM operations_kpi_rollups_hourly) AS hourly_rows_total,
        (SELECT COUNT(*)::bigint FROM operations_kpi_rollups_daily) AS daily_rows_total
    `);
    console.log('[kpi-rollups] Current table counts:', counts.rows[0] || null);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[kpi-rollups] Failed:', error?.message || error);
  process.exit(1);
});

