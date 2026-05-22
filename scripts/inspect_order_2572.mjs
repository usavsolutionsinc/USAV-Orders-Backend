import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
const url = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env','utf8').match(/^DATABASE_URL_UNPOOLED=(.+)$/m)[1].trim();
const sql = neon(url);

console.log('=== order #2572 lifecycle ===');
const o = await sql`SELECT id, order_id, status, shipment_id, sku_catalog_id, sku, created_at::text FROM orders WHERE id = 2572`;
console.log('order:', o[0]);

console.log('\n=== packer_logs for that shipment ===');
const pl = await sql`SELECT id, tracking_type, packed_by, created_at::text, shipment_id, scan_ref FROM packer_logs WHERE shipment_id = ${o[0].shipment_id}`;
for (const r of pl) console.log(' ', JSON.stringify(r));

console.log('\n=== shipping_tracking_numbers for that shipment ===');
const stn = await sql`SELECT id, tracking_number_raw, carrier, latest_status_code, latest_status_label, delivered_at::text, created_at::text FROM shipping_tracking_numbers WHERE id = ${o[0].shipment_id}`;
for (const r of stn) console.log(' ', JSON.stringify(r));

console.log('\n=== allocations + serial_units ===');
const a = await sql`SELECT oua.id, oua.state::text, oua.serial_unit_id, oua.allocated_at::text, su.current_status::text AS unit_status FROM order_unit_allocations oua JOIN serial_units su ON su.id = oua.serial_unit_id WHERE oua.order_id = 2572`;
for (const r of a) console.log(' ', JSON.stringify(r));
