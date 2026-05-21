import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
const url = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env', 'utf8').match(/^DATABASE_URL_UNPOOLED=(.+)$/m)[1].trim();
const sql = neon(url);

console.log('=== open-order SKUs (top 10 by count) ===');
const orderSkus = await sql`
  SELECT COALESCE(sku,'(null)') AS sku, COUNT(*)::int AS n
    FROM orders
   WHERE LOWER(COALESCE(status, 'open')) NOT IN ('shipped','cancelled','closed','complete','completed','void','voided','refunded')
   GROUP BY sku ORDER BY n DESC LIMIT 10
`;
for (const r of orderSkus) console.log(`  ${r.sku.padEnd(40)} ${r.n}`);

console.log('\n=== STOCKED unit SKUs ===');
const unitSkus = await sql`
  SELECT COALESCE(sku,'(null)') AS sku, COUNT(*)::int AS n
    FROM serial_units WHERE current_status='STOCKED'
   GROUP BY sku ORDER BY n DESC
`;
for (const r of unitSkus) console.log(`  ${r.sku.padEnd(20)} ${r.n}`);

console.log('\n=== Are open-order SKUs an EXACT match of any STOCKED SKU? ===');
const exact = await sql`
  SELECT DISTINCT o.sku
    FROM orders o
    JOIN serial_units su ON su.sku = o.sku AND su.current_status = 'STOCKED'
   WHERE LOWER(COALESCE(o.status, 'open')) NOT IN ('shipped','cancelled','closed','complete','completed','void','voided','refunded')
`;
console.log(`  exact-match SKU overlap rows: ${exact.length}`);

console.log('\n=== Total open-orders sku=null vs sku=set ===');
const nullCount = await sql`
  SELECT
    SUM(CASE WHEN sku IS NULL OR sku = '' THEN 1 ELSE 0 END)::int AS null_sku,
    SUM(CASE WHEN sku IS NOT NULL AND sku <> '' THEN 1 ELSE 0 END)::int AS set_sku
    FROM orders
   WHERE LOWER(COALESCE(status, 'open')) NOT IN ('shipped','cancelled','closed','complete','completed','void','voided','refunded')
`;
console.log(`  null sku: ${nullCount[0].null_sku}`);
console.log(`  set sku:  ${nullCount[0].set_sku}`);
