import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
const url = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env','utf8').match(/^DATABASE_URL_UNPOOLED=(.+)$/m)[1].trim();
const sql = neon(url);

const r = await sql`
  SELECT o.id, o.order_id, o.account_source, o.sku AS platform_sku, sc.sku AS canonical_sku,
         (SELECT COUNT(*)::int FROM serial_units su WHERE su.sku = sc.sku AND su.current_status = 'STOCKED') AS stocked_units
    FROM orders o
    JOIN sku_catalog sc ON sc.id = o.sku_catalog_id
   WHERE (o.status IS NULL OR o.status != 'shipped')
     AND o.sku_catalog_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM serial_units su WHERE su.sku = sc.sku AND su.current_status = 'STOCKED')
   ORDER BY stocked_units DESC, o.id ASC
   LIMIT 30
`;
console.log(`${r.length} open orders allocatable today (have sku_catalog_id AND ≥1 STOCKED unit):`);
for (const row of r) console.log(`  order #${row.id}  ${row.order_id || '-'}  src=${row.account_source || '(null)'}  ${row.platform_sku || '(null)'} → ${row.canonical_sku}  stocked=${row.stocked_units}`);
