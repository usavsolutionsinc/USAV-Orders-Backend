#!/usr/bin/env node
// Apply 2026-05-18_staff_permission_overrides.sql against DATABASE_URL.
// Idempotent — uses ADD COLUMN IF NOT EXISTS.

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, '..', 'src', 'lib', 'migrations', '2026-05-18_staff_permission_overrides.sql');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const sql = readFileSync(sqlPath, 'utf8');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

  console.log('→ Connecting to database…');
  await client.connect();

  try {
    console.log('→ Applying 2026-05-18_staff_permission_overrides.sql');
    await client.query(sql);
    console.log('✓ Migration applied');

    const check = await client.query(`
      SELECT
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='staff' AND column_name='permissions_added')   AS c_added,
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='staff' AND column_name='permissions_removed') AS c_removed
    `);
    console.table(check.rows[0]);
  } catch (err) {
    console.error('✗ Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
