import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
const url = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env','utf8').match(/^DATABASE_URL_UNPOOLED=(.+)$/m)[1].trim();
const sql = neon(url);

console.log('=== What the picker UI for order #2572 will show ===');
const tasks = await sql`
  SELECT oua.id AS allocation_id, oua.state::text, oua.serial_unit_id,
         su.sku, su.current_status::text AS unit_status,
         su.current_location AS bin_id,
         l.name AS bin_name, l.barcode AS bin_barcode,
         sc.product_title
    FROM order_unit_allocations oua
    JOIN serial_units su ON su.id = oua.serial_unit_id
    LEFT JOIN locations l ON l.id::text = su.current_location
    LEFT JOIN sku_catalog sc ON sc.sku = su.sku
   WHERE oua.order_id = 2572
`;
for (const t of tasks) {
  console.log(`  allocation #${t.allocation_id} state=${t.state}`);
  console.log(`    unit #${t.serial_unit_id} sku=${t.sku} status=${t.unit_status}`);
  console.log(`    bin: id=${t.bin_id} name="${t.bin_name}" barcode="${t.bin_barcode}"`);
  console.log(`    product: ${t.product_title}`);
}
