#!/usr/bin/env node
// One-off runner for 2026-04-15_link_orphan_lines_by_po.sql.
// Prints before/after counts so the delta is visible.

import 'dotenv/config';
import { Pool } from '@neondatabase/serverless';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_FILE = path.resolve(
  __dirname,
  '../src/lib/migrations/2026-04-15_link_orphan_lines_by_po.sql',
);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function diag(label) {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM receiving_lines)                         AS lines_total,
      (SELECT COUNT(*) FROM receiving_lines WHERE receiving_id IS NULL
          AND zoho_purchaseorder_id IS NOT NULL
          AND zoho_purchaseorder_id <> '')                            AS lines_orphan_with_po,
      (SELECT COUNT(*) FROM receiving WHERE source = 'zoho_po')       AS receiving_zoho_po_rows
  `);
  console.log(`[${label}]`, rows[0]);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — aborting');
    process.exit(2);
  }

  await diag('before');

  const sql = await fs.readFile(SQL_FILE, 'utf8');
  console.log(`\nApplying ${path.relative(process.cwd(), SQL_FILE)} …`);
  const start = Date.now();
  await pool.query(sql);
  console.log(`Done in ${Date.now() - start}ms\n`);

  await diag('after');

  // Specifically show the PO# the user asked about.
  const targetPo = '5623409000001882005';
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM receiving_lines
         WHERE zoho_purchaseorder_id = $1)                                AS lines_total,
      (SELECT COUNT(*) FROM receiving_lines
         WHERE zoho_purchaseorder_id = $1 AND receiving_id IS NULL)       AS lines_orphan,
      (SELECT id FROM receiving
         WHERE source = 'zoho_po' AND zoho_purchaseorder_id = $1 LIMIT 1) AS receiving_id,
      (SELECT source_platform FROM receiving
         WHERE source = 'zoho_po' AND zoho_purchaseorder_id = $1 LIMIT 1) AS current_platform
  `, [targetPo]);
  console.log(`[PO ${targetPo}]`, rows[0]);

  await pool.end();
}

main().catch((err) => {
  console.error('FAILED:', err);
  pool.end().finally(() => process.exit(1));
});
