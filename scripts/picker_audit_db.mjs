import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const envText = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env', 'utf8');
const url = (envText.match(/^DATABASE_URL_UNPOOLED=(.+)$/m) || envText.match(/^DATABASE_URL=(.+)$/m))[1].trim();
const sql = neon(url);

console.log('=== ORDERS BACKLOG SIZING ===\n');

// Orders with no allocations at all — backfill candidates.
const openOrders = await sql`
  SELECT COUNT(*)::int AS n
    FROM orders o
   WHERE LOWER(COALESCE(o.status, 'open')) NOT IN ('shipped','cancelled','closed','complete','completed','void','voided','refunded')
     AND NOT EXISTS (
       SELECT 1 FROM order_unit_allocations oua WHERE oua.order_id = o.id
     )
`;
console.log(`open orders missing allocations: ${openOrders[0].n}`);

const recentOpen = await sql`
  SELECT id, order_id, sku, quantity, status, account_source, created_at::text
    FROM orders
   WHERE LOWER(COALESCE(status, 'open')) NOT IN ('shipped','cancelled','closed','complete','completed','void','voided','refunded')
   ORDER BY created_at DESC
   LIMIT 10
`;
console.log('\n  10 most recent open orders:');
for (const r of recentOpen) console.log(`    #${r.id}  ${r.order_id?.padEnd(18) ?? '(no ext)'}  ${(r.sku ?? '').padEnd(30)}  qty=${r.quantity}  status=${r.status}  source=${r.account_source}`);

console.log('\n=== STATUS DISTRIBUTION (all orders) ===');
const statusDist = await sql`SELECT COALESCE(status,'(null)') AS status, COUNT(*)::int AS n FROM orders GROUP BY status ORDER BY n DESC LIMIT 20`;
for (const r of statusDist) console.log(`  ${r.status.padEnd(25)} ${r.n}`);

console.log('\n=== SERIAL UNIT STATUS HISTOGRAM ===');
const unitStatus = await sql`SELECT current_status::text AS s, COUNT(*)::int AS n FROM serial_units GROUP BY current_status ORDER BY n DESC`;
for (const r of unitStatus) console.log(`  ${r.s.padEnd(15)} ${r.n}`);

console.log('\n=== HOW MANY STOCKED UNITS COULD BE ALLOCATED RIGHT NOW ===');
const stocked = await sql`SELECT COUNT(*)::int AS n FROM serial_units WHERE current_status = 'STOCKED'`;
console.log(`  STOCKED units: ${stocked[0].n}`);

const skuOverlap = await sql`
  SELECT COUNT(DISTINCT o.sku)::int AS sku_overlap, COUNT(*)::int AS coverable_lines
    FROM orders o
    JOIN serial_units su ON su.sku = o.sku AND su.current_status = 'STOCKED'
   WHERE LOWER(COALESCE(o.status, 'open')) NOT IN ('shipped','cancelled','closed','complete','completed','void','voided','refunded')
     AND NOT EXISTS (SELECT 1 FROM order_unit_allocations oua WHERE oua.order_id = o.id)
`;
console.log(`  SKUs overlapping open-orders ↔ STOCKED: ${skuOverlap[0].sku_overlap}`);
console.log(`  open-order lines that have ≥1 STOCKED matching unit: ${skuOverlap[0].coverable_lines}`);

console.log('\n=== organization_feature_flags rows (per-tenant overrides) ===');
try {
  const orgFlags = await sql`SELECT organization_id, flag, enabled FROM organization_feature_flags WHERE flag LIKE 'inventory_v2%' OR flag LIKE 'INVENTORY_V2%' ORDER BY organization_id, flag`;
  if (orgFlags.length === 0) console.log('  (none — using env var defaults)');
  for (const r of orgFlags) console.log(`  ${r.organization_id} :: ${r.flag} = ${r.enabled}`);
} catch (e) {
  console.log('  (table missing or query failed: ' + e.message + ')');
}

console.log('\n=== packer_logs activity by day (last 14 days) ===');
const packDaily = await sql`
  SELECT DATE_TRUNC('day', created_at)::date::text AS day, COUNT(*)::int AS n
    FROM packer_logs
   WHERE created_at >= NOW() - INTERVAL '14 days'
   GROUP BY 1 ORDER BY 1 DESC
`;
for (const r of packDaily) console.log(`  ${r.day}  ${String(r.n).padStart(4)}`);

console.log('\n=== inventory_events activity by event_type (last 14 days) ===');
const evDaily = await sql`
  SELECT event_type, COUNT(*)::int AS n
    FROM inventory_events
   WHERE occurred_at >= NOW() - INTERVAL '14 days'
   GROUP BY event_type ORDER BY n DESC
`;
for (const r of evDaily) console.log(`  ${r.event_type.padEnd(18)} ${r.n}`);
