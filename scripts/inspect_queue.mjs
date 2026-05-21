import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
const envText = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env', 'utf8');
const url = (envText.match(/^DATABASE_URL_UNPOOLED=(.+)$/m) || envText.match(/^DATABASE_URL=(.+)$/m))[1].trim();
const sql = neon(url);

console.log('=== orders table columns ===');
const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='orders' AND table_schema='public' ORDER BY ordinal_position`;
console.log(cols.map(c => `${c.column_name}:${c.data_type}`).join(', '));

console.log('\n=== work_assignments columns ===');
const wa = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='work_assignments' AND table_schema='public' ORDER BY ordinal_position`;
console.log(wa.map(c => `${c.column_name}:${c.data_type}`).join(', '));

console.log('\n=== are there any allocations at all? ===');
const allocs = await sql`SELECT state::text AS state, COUNT(*)::int AS n FROM order_unit_allocations GROUP BY state`;
console.log(allocs);

console.log('\n=== current open orders count by status ===');
const orderStatuses = await sql`SELECT status, COUNT(*)::int AS n FROM orders GROUP BY status ORDER BY n DESC LIMIT 12`;
console.log(orderStatuses);
