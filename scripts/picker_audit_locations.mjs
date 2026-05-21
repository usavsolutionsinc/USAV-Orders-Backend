import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const envText = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env', 'utf8');
const url = (envText.match(/^DATABASE_URL_UNPOOLED=(.+)$/m) || envText.match(/^DATABASE_URL=(.+)$/m))[1].trim();
const sql = neon(url);

console.log('=== locations table — what bins exist? ===');
const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='locations' AND table_schema='public' ORDER BY ordinal_position`;
console.log('Columns:', cols.map(c => `${c.column_name}:${c.data_type}`).join(', '));

const locs = await sql`SELECT * FROM locations ORDER BY id LIMIT 30`;
console.log(`\nLocations (showing ${locs.length}):`);
for (const l of locs) console.log(`  ${JSON.stringify(l)}`);

console.log('\n=== mark-received call pattern: do any recent receives carry destination_bin_id? ===');
const recentReceives = await sql`
  SELECT id, occurred_at::text, event_type, sku, bin_id, serial_unit_id, payload
    FROM inventory_events
   WHERE event_type IN ('RECEIVED','PUTAWAY')
   ORDER BY occurred_at DESC
   LIMIT 10
`;
for (const r of recentReceives) console.log(`  [${r.event_type}] ${r.occurred_at}  sku=${r.sku}  bin_id=${r.bin_id}  unit=${r.serial_unit_id}  payload=${JSON.stringify(r.payload)}`);

console.log('\n=== Are there any PUTAWAY events at all? ===');
const putawayCount = await sql`SELECT COUNT(*)::int AS n FROM inventory_events WHERE event_type='PUTAWAY'`;
console.log(`  PUTAWAY events: ${putawayCount[0].n}`);
