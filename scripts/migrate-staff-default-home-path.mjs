#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, '..', 'src', 'lib', 'migrations', '2026-05-17_staff_default_home_path.sql');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) { console.error('DATABASE_URL not set'); process.exit(1); }
  const sql = readFileSync(sqlPath, 'utf8');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    console.log('→ Applying 2026-05-17_staff_default_home_path.sql');
    await client.query(sql);
    const r = await client.query(`
      SELECT id, name, role, default_home_path FROM staff ORDER BY id
    `);
    console.table(r.rows);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
