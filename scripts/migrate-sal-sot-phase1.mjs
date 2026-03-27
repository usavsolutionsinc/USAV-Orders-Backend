/**
 * Phase 1: SAL as Single Source of Truth
 * - Backfills context_station_activity_log_id on tech_serial_numbers
 * - Adds station_activity_log_id FK to fba_fnsku_logs and backfills
 *
 * Usage: node scripts/migrate-sal-sot-phase1.mjs
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
  '../src/lib/migrations/2026-03-27_sal_sot_phase1.sql',
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
    console.log('');

    // Pre-migration stats
    const tsnNullCount = await client.query(
      `SELECT COUNT(*) AS cnt FROM tech_serial_numbers WHERE context_station_activity_log_id IS NULL`
    );
    console.log(`TSN rows with NULL context_station_activity_log_id: ${tsnNullCount.rows[0].cnt}`);

    const flColExists = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'fba_fnsku_logs' AND column_name = 'station_activity_log_id'`
    );
    console.log(`fba_fnsku_logs.station_activity_log_id exists: ${flColExists.rows.length > 0}`);
    console.log('');

    await client.query(sql);

    // Post-migration stats
    const tsnNullAfter = await client.query(
      `SELECT COUNT(*) AS cnt FROM tech_serial_numbers WHERE context_station_activity_log_id IS NULL`
    );
    const tsnTotal = await client.query(`SELECT COUNT(*) AS cnt FROM tech_serial_numbers`);
    console.log(`TSN total: ${tsnTotal.rows[0].cnt}`);
    console.log(`TSN still NULL after backfill: ${tsnNullAfter.rows[0].cnt}`);

    const flBackfilled = await client.query(
      `SELECT COUNT(*) AS cnt FROM fba_fnsku_logs WHERE station_activity_log_id IS NOT NULL`
    );
    const flTotal = await client.query(
      `SELECT COUNT(*) AS cnt FROM fba_fnsku_logs WHERE source_stage = 'TECH'`
    );
    console.log(`fba_fnsku_logs TECH rows: ${flTotal.rows[0].cnt}`);
    console.log(`fba_fnsku_logs backfilled with SAL FK: ${flBackfilled.rows[0].cnt}`);

    console.log('');
    console.log('Migration complete.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
