#!/usr/bin/env node
// Apply 2026-05-17_auth_system.sql against DATABASE_URL.
//
// Idempotent — every statement uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS,
// so this is safe to re-run.
//
// Usage:
//   node scripts/migrate-auth-system.mjs
//
// Or with a different DB:
//   DATABASE_URL=postgres://... node scripts/migrate-auth-system.mjs

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, '..', 'src', 'lib', 'migrations', '2026-05-17_auth_system.sql');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const sql = readFileSync(sqlPath, 'utf8');
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  console.log('→ Connecting to database…');
  await client.connect();

  try {
    console.log('→ Applying 2026-05-17_auth_system.sql');
    await client.query(sql);
    console.log('✓ Migration applied');

    // Quick smoke check
    const check = await client.query(`
      SELECT
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='staff'             AND column_name='pin_hash')         AS staff_pin_hash,
        EXISTS(SELECT 1 FROM information_schema.tables  WHERE table_name='staff_passkeys')                                       AS t_passkeys,
        EXISTS(SELECT 1 FROM information_schema.tables  WHERE table_name='staff_sessions')                                       AS t_sessions,
        EXISTS(SELECT 1 FROM information_schema.tables  WHERE table_name='staff_enrollments')                                    AS t_enrollments,
        EXISTS(SELECT 1 FROM information_schema.tables  WHERE table_name='staff_stepups')                                        AS t_stepups,
        EXISTS(SELECT 1 FROM information_schema.tables  WHERE table_name='auth_audit')                                           AS t_audit
    `);
    console.table(check.rows[0]);
  } catch (err) {
    console.error('✗ Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
