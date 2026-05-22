import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
const url = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env','utf8').match(/^DATABASE_URL_UNPOOLED=(.+)$/m)[1].trim();
const sql = neon(url);

console.log('=== shipping_tracking_numbers columns ===');
const stnCols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='shipping_tracking_numbers' AND table_schema='public' ORDER BY ordinal_position`;
console.log(stnCols.map(c => c.column_name).join(', '));

console.log('\n=== orders shipment_id linkage check ===');
const sample = await sql`
  SELECT o.id AS order_id, o.shipment_id, o.order_id AS order_label, o.status,
         pl.id AS packer_log_id, pl.created_at AS packed_at, pl.tracking_type,
         (SELECT COUNT(*)::int FROM order_unit_allocations oua WHERE oua.order_id = o.id) AS allocation_count
    FROM orders o
    LEFT JOIN packer_logs pl ON pl.shipment_id = o.shipment_id
   WHERE pl.id IS NOT NULL
   ORDER BY pl.id DESC
   LIMIT 5
`;
for (const r of sample) console.log(`  order #${r.order_id} label=${r.order_label} ship=${r.shipment_id} pl=${r.packer_log_id} packed=${r.packed_at} type=${r.tracking_type} allocs=${r.allocation_count}`);

console.log('\n=== count: orders w/ allocations + corresponding packer_logs ===');
const counts = await sql`
  SELECT
    COUNT(DISTINCT o.id) FILTER (WHERE pl.id IS NOT NULL AND oua.id IS NOT NULL) AS both,
    COUNT(DISTINCT o.id) FILTER (WHERE pl.id IS NOT NULL AND oua.id IS NULL) AS pl_only,
    COUNT(DISTINCT o.id) FILTER (WHERE pl.id IS NULL AND oua.id IS NOT NULL) AS alloc_only
    FROM orders o
    LEFT JOIN packer_logs pl ON pl.shipment_id = o.shipment_id
    LEFT JOIN order_unit_allocations oua ON oua.order_id = o.id
`;
console.log(counts[0]);
