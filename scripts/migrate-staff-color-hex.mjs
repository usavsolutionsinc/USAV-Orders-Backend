#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, '..', 'src', 'lib', 'migrations', '2026-05-17_staff_color_hex.sql');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) { console.error('DATABASE_URL not set'); process.exit(1); }
  const sql = readFileSync(sqlPath, 'utf8');
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    console.log('→ Applying 2026-05-17_staff_color_hex.sql');
    await client.query(sql);
    const check = await client.query(`
      SELECT id, name, color_hex
      FROM staff
      ORDER BY id
      LIMIT 12
    `);
    console.table(check.rows);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
