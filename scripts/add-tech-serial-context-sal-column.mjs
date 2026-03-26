/**
 * Adds tech_serial_numbers.context_station_activity_log_id (+ index).
 *
 * Usage: node scripts/add-tech-serial-context-sal-column.mjs
 * Requires DATABASE_URL in .env (repo root).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const { Pool } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Add it to .env and retry.');
  process.exit(1);
}

const sqlPath = path.resolve(
  __dirname,
  '../src/lib/migrations/2026-03-25_tech_serial_numbers_context_station_activity_log.sql',
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
    console.log('Done: tech_serial_numbers.context_station_activity_log_id is ready.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
