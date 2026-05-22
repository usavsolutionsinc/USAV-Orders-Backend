/**
 * sku_mapping_inspect.mjs — short follow-up to the normalization audit.
 *
 * The audit surfaced several SKU-adjacent tables I didn't know existed.
 * Check whether any of them already encode marketplace_sku → internal_sku
 * mappings, which would change the Phase 2 plan from "build a mapping
 * system" to "wire up the existing mapping."
 *
 * Tables to inspect: sku, sku_management, sku_platform_ids, available_sku_suffixes.
 */

import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const envText = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env', 'utf8');
const url = (envText.match(/^DATABASE_URL_UNPOOLED=(.+)$/m) || envText.match(/^DATABASE_URL=(.+)$/m))[1].trim();
const sql = neon(url);

const TABLES = ['sku', 'sku_management', 'sku_platform_ids', 'available_sku_suffixes', 'sku_stock'];

for (const t of TABLES) {
  console.log(`\n=== ${t} ===`);
  const cols = await sql.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [t],
  );
  console.log('cols:', cols.map(c => `${c.column_name}:${c.data_type}`).join(', '));
  const count = await sql.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
  console.log(`rows: ${count[0].n}`);
  if (count[0].n > 0) {
    const sample = await sql.query(`SELECT * FROM ${t} LIMIT 5`);
    for (const r of sample) console.log(' ', JSON.stringify(r).slice(0, 240));
  }
}

console.log(`\n=== Question: does sku_platform_ids relate ORDER SKUs to STOCKED SKUs? ===`);
try {
  const cross = await sql`
    SELECT spi.*
      FROM sku_platform_ids spi
     WHERE EXISTS (SELECT 1 FROM orders o
                    WHERE (o.status IS NULL OR o.status != 'shipped')
                      AND o.sku IS NOT NULL
                      AND o.sku = spi.platform_sku)
     LIMIT 5
  `;
  console.log('Sample marketplace matches (if any):', cross.length);
  for (const r of cross) console.log(' ', JSON.stringify(r).slice(0, 240));
} catch (e) {
  console.log('Skip — platform_sku column not present:', e.message.slice(0, 120));
}
