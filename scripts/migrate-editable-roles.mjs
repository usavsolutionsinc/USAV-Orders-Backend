#!/usr/bin/env node
// Apply 2026-05-19_editable_roles.sql and then seed the 8 system roles.
// Idempotent on both fronts (IF NOT EXISTS on tables, ON CONFLICT on key).

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, '..', 'src', 'lib', 'migrations', '2026-05-19_editable_roles.sql');
const seedPath = join(__dirname, 'seed-roles.mjs');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  // Apply the schema migration.
  const sql = readFileSync(sqlPath, 'utf8');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  console.log('→ Connecting to database…');
  await client.connect();
  try {
    console.log('→ Applying 2026-05-19_editable_roles.sql');
    await client.query(sql);
    console.log('✓ Schema applied');
    const check = await client.query(`
      SELECT
        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='roles')       AS t_roles,
        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='staff_roles') AS t_staff_roles
    `);
    console.table(check.rows[0]);
  } finally {
    await client.end();
  }

  // Run the seed in a separate process so its imports are fresh.
  console.log('→ Seeding system roles…');
  await new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [seedPath], { stdio: 'inherit' });
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed exited ${code}`))));
    proc.on('error', reject);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
