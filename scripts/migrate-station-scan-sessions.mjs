/**
 * Applies src/lib/migrations/2026-03-25_station_scan_sessions_idempotency.sql
 * (station_scan_sessions + api_idempotency_responses).
 *
 * Usage: node scripts/migrate-station-scan-sessions.mjs
 * Requires DATABASE_URL in .env (repo root).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { Pool } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Add it to .env and retry.');
  process.exit(1);
}

const sqlPath = path.resolve(
  __dirname,
  '../src/lib/migrations/2026-03-25_station_scan_sessions_idempotency.sql',
);
const sql = fs.readFileSync(sqlPath, 'utf8');

const pool = new Pool({
  connectionString: url,
  ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    console.log('Running migration:', sqlPath);
    await client.query(sql);
    console.log('Done: station_scan_sessions + api_idempotency_responses are ready.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
