#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, '..', 'src', 'lib', 'migrations', '2026-05-17_shifts_calendar_payroll.sql');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) { console.error('DATABASE_URL not set'); process.exit(1); }
  const sql = readFileSync(sqlPath, 'utf8');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    console.log('→ Applying 2026-05-17_shifts_calendar_payroll.sql');
    await client.query(sql);
    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM shift_templates)::INT   AS templates,
        (SELECT COUNT(*) FROM shifts)::INT            AS shifts,
        (SELECT COUNT(*) FROM time_punches)::INT      AS punches,
        (SELECT COUNT(*) FROM staff_pay_rates)::INT   AS rates,
        (SELECT COUNT(*) FROM pay_periods)::INT       AS pay_periods,
        (SELECT COUNT(*) FROM time_off_requests)::INT AS time_off
    `);
    console.table(counts.rows[0]);

    const horizon = await client.query(`
      SELECT s.id, s.name, s.shifts_materialized_through
      FROM staff s
      WHERE COALESCE(s.active, true) = true
      ORDER BY s.id
    `);
    console.log('\nMaterialization horizon per staff:');
    console.table(horizon.rows);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
