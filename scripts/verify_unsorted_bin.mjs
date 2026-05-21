import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
const url = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env', 'utf8').match(/^DATABASE_URL_UNPOOLED=(.+)$/m)[1].trim();
const sql = neon(url);
const r = await sql`SELECT id, name, barcode, bin_role::text AS bin_role, is_active, sort_order FROM locations WHERE barcode = 'UNSORTED'`;
console.log('UNSORTED bin row(s):');
for (const row of r) console.log('  ', JSON.stringify(row));
