import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
const url = readFileSync('/Users/salessupport/Desktop/my-express-app/USAV-Orders-Backend/.env','utf8').match(/^DATABASE_URL_UNPOOLED=(.+)$/m)[1].trim();
const sql = neon(url);

console.log('=== packer_logs columns ===');
const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='packer_logs' AND table_schema='public' ORDER BY ordinal_position`;
console.log(cols.map(c => `${c.column_name}:${c.data_type}`).join(', '));

console.log('\n=== row count + recent activity ===');
const recent = await sql`
  SELECT DATE(created_at AT TIME ZONE 'America/Los_Angeles') AS day, COUNT(*)::int AS n
    FROM packer_logs
   WHERE created_at > NOW() - INTERVAL '14 days'
   GROUP BY day ORDER BY day DESC
`;
for (const r of recent) console.log(`  ${r.day}  ${r.n}`);

console.log('\n=== sample latest packer_logs rows ===');
const sample = await sql`SELECT * FROM packer_logs ORDER BY id DESC LIMIT 3`;
for (const r of sample) console.log(`  ${JSON.stringify(r).slice(0, 300)}`);
