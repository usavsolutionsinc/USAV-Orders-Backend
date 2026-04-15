#!/usr/bin/env node
// One-off: apply 2026-04-13_receiving_lines_add_po_number.sql.
import 'dotenv/config';
import { Pool } from '@neondatabase/serverless';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL = path.resolve(__dirname, '../src/lib/migrations/2026-04-13_receiving_lines_add_po_number.sql');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const sql = await fs.readFile(SQL, 'utf8');
  console.log(`Applying ${path.relative(process.cwd(), SQL)} …`);
  const start = Date.now();
  await pool.query(sql);
  console.log(`Done in ${Date.now() - start}ms`);

  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM receiving_lines)                                              AS lines_total,
      (SELECT COUNT(*) FROM receiving_lines WHERE zoho_purchaseorder_number IS NOT NULL)  AS lines_with_po_number
  `);
  console.log(rows[0]);
  await pool.end();
}

main().catch((err) => {
  console.error('FAILED:', err);
  pool.end().finally(() => process.exit(1));
});
