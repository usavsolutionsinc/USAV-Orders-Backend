import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
const url = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env', 'utf8').match(/^DATABASE_URL_UNPOOLED=(.+)$/m)[1].trim();
const sql = neon(url);

// Open orders whose SKU has at least one STOCKED unit ready to allocate.
const matches = await sql`
  SELECT o.id AS order_id, o.order_id AS external_id, o.sku, o.quantity,
         COUNT(su.id)::int AS stocked_units_available
    FROM orders o
    JOIN serial_units su ON su.sku = o.sku AND su.current_status = 'STOCKED'
   WHERE LOWER(COALESCE(o.status, 'open')) NOT IN ('shipped','cancelled','closed','complete','completed','void','voided','refunded')
     AND NOT EXISTS (SELECT 1 FROM order_unit_allocations oua WHERE oua.order_id = o.id)
   GROUP BY o.id, o.order_id, o.sku, o.quantity
   ORDER BY stocked_units_available DESC, o.id DESC
   LIMIT 20
`;
console.log(`Open orders that COULD now allocate (SKU has STOCKED units): ${matches.length}\n`);
for (const r of matches) {
  console.log(`  order #${r.order_id.toString().padEnd(5)} ext=${(r.external_id||'').padEnd(22)} sku=${(r.sku||'').padEnd(20)} qty=${r.quantity} stocked_available=${r.stocked_units_available}`);
}
const total = await sql`
  SELECT COUNT(DISTINCT o.id)::int AS n
    FROM orders o
    JOIN serial_units su ON su.sku = o.sku AND su.current_status = 'STOCKED'
   WHERE LOWER(COALESCE(o.status, 'open')) NOT IN ('shipped','cancelled','closed','complete','completed','void','voided','refunded')
     AND NOT EXISTS (SELECT 1 FROM order_unit_allocations oua WHERE oua.order_id = o.id)
`;
console.log(`\nTotal coverable open orders: ${total[0].n}`);
